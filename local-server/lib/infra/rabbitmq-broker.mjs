// local-server/lib/infra/rabbitmq-broker.mjs
// Resilient AMQP Task Broker for Distributed DAG Steps & Background Workflows with DLQ Routing

import amqp from "amqplib";

let _connection = null;
let _channel = null;
let _pool = null;
let _isEnabled = false;
let _activeUri = "amqp://guest:guest@127.0.0.1:5672";
let _prefetch = 10;

const DAG_EXCHANGE = "elara.dag.exchange";
const DAG_QUEUE = "elara.dag.tasks";
const DAG_DLQ = "elara.dag.tasks.dlq";
const INGEST_QUEUE = "elara.ingest.jobs";

// In-Memory Task Queue Fallback when RabbitMQ is disabled/offline
const IN_MEMORY_QUEUE = [];
let _publishedCount = 0;
let _completedCount = 0;
let _failedCount = 0;

/**
 * Initialize RabbitMQ connection and topology
 */
export async function initRabbitBroker(pool) {
  _pool = pool;
  try {
    const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='infra.rabbitmq'");
    const cfg = rows[0]?.value || {};
    _isEnabled = !!cfg.enabled;
    _activeUri = cfg.uri || process.env.RABBITMQ_URL || "amqp://guest:guest@127.0.0.1:5672";
    _prefetch = Number(cfg.prefetch) || 10;

    if (_isEnabled && !_connection) {
      _connection = await amqp.connect(_activeUri);
      _channel = await _connection.createChannel();
      await _channel.prefetch(_prefetch);

      // Assert Topology: Dead-Letter Exchange + DLQ + Main Task Queue
      await _channel.assertExchange(DAG_EXCHANGE, "direct", { durable: true });
      await _channel.assertQueue(DAG_DLQ, { durable: true });
      await _channel.assertQueue(DAG_QUEUE, {
        durable: true,
        arguments: {
          "x-dead-letter-exchange": DAG_EXCHANGE,
          "x-dead-letter-routing-key": "dlq",
        },
      });
      await _channel.bindQueue(DAG_DLQ, DAG_EXCHANGE, "dlq");
      await _channel.assertQueue(INGEST_QUEUE, { durable: true });

      _connection.on("error", (err) => {
        console.warn(`[RabbitMQ] ⚠️ Connection warning: ${err.message}. Using In-Memory fallback.`);
      });
      _connection.on("close", () => {
        _connection = null;
        _channel = null;
      });

      console.log(`[RabbitMQ] ✅ Task Broker connected to ${_activeUri}`);
    }
  } catch (e) {
    console.warn(`[RabbitMQ] Initialization notice: ${e.message}`);
  }
}

/**
 * Publish a DAG step or background workflow task
 */
export async function publishDagTask(task) {
  _publishedCount++;
  const payload = {
    ...task,
    publishedAt: Date.now(),
  };

  const buf = Buffer.from(JSON.stringify(payload));

  // 1. Publish to AMQP if connected
  if (_isEnabled && _channel) {
    try {
      return _channel.sendToQueue(DAG_QUEUE, buf, {
        persistent: true,
        contentType: "application/json",
      });
    } catch (err) {
      console.warn(`[RabbitMQ] Publish error: ${err.message}. Falling back to in-memory.`);
    }
  }

  // 2. Fallback to In-Memory Queue
  IN_MEMORY_QUEUE.push(payload);
  return true;
}

/**
 * Consume DAG tasks with worker callback
 */
export async function consumeDagTasks(workerFn) {
  if (_isEnabled && _channel) {
    try {
      await _channel.consume(DAG_QUEUE, async (msg) => {
        if (!msg) return;
        try {
          const task = JSON.parse(msg.content.toString());
          await workerFn(task);
          _channel.ack(msg);
          _completedCount++;
        } catch (err) {
          _failedCount++;
          console.error(`[RabbitMQ] Task failed: ${err.message}. Sending to DLQ.`);
          _channel.nack(msg, false, false); // Nack without requeue → routes to DLQ
        }
      });
    } catch (err) {
      console.warn(`[RabbitMQ] Consumer error: ${err.message}`);
    }
  }

  // Also drain any tasks in In-Memory Queue
  while (IN_MEMORY_QUEUE.length > 0) {
    const task = IN_MEMORY_QUEUE.shift();
    try {
      await workerFn(task);
      _completedCount++;
    } catch (err) {
      _failedCount++;
      console.error(`[In-Memory Task Queue] Failed: ${err.message}`);
    }
  }
}

/**
 * Return live broker telemetry and health metrics
 */
export function getRabbitBrokerStats() {
  return {
    enabled: _isEnabled,
    connected: _isEnabled && _connection !== null,
    mode: _isEnabled && _connection !== null ? "amqp-cluster" : "direct-sync-fallback",
    published: _publishedCount,
    completed: _completedCount,
    failed: _failedCount,
    inMemoryQueueDepth: IN_MEMORY_QUEUE.length,
  };
}
