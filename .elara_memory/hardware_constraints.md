# ELARA Memory - Hardware Constraints & Strategy Update

## Incident: Memory Exhaustion (2026-07-24)
- **Error**: `libc++abi: terminating due to uncaught exception of type std::runtime_error: [METAL] Command buffer execution failed: Insufficient Memory`
- **Cause**: Parallel execution of multiple heavy analysis agents combined with large codebase scanning exceeded the M5 Max's unified memory limits.
- **Impact**: System crash/termination of the MLX server.

## New Operational Strategy: "Safe-Mode"
To prevent further memory exhaustion and ensure system stability, the following rules are now in effect:

1. **Sequential Execution**: NO parallel subagents for heavy tasks. Only one worker agent will be active at a time.
2. **Targeted Scanning**: Avoid "scan everything" prompts. Break analysis into small, directory-specific or file-specific tasks.
3. **Context Pruning**: Regularly summarize and save state to `.elara_memory/` to keep the active chat context lean.
4. **Resource Monitoring**: Be mindful of the GPU/RAM load on the M5 Max during heavy inference or large-scale codebase reads.

## Memory & Performance Optimizations (2026-07-25)
- **Config Change**: `max_position_embeddings` reduced from `262144` to `32768`.
- **Reason**: Prevent "Out Of Memory" (OOM) crashes on the host machine during heavy inference tasks.
- **Hardware Context**: Host is the maximum available Apple Silicon configuration (RAM maxed out).
- **Trade-off**: Reduced maximum context size in exchange for system stability. If the model fails to capture enough context for a task, this value may be incrementally increased.
