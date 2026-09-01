// local-server/lib/deps.mjs

// Dosyanın en üstüne, importlardan hemen sonraya ekliyorum
export const config = {
  port: process.env.PORT || 3005,
  pythonWorkerUrl: process.env.PYTHON_WORKER_URL || `http://localhost:${process.env.EMBED_WORKER_PORT || 8082}`,
  baseUrl: process.env.BASE_URL || 'http://localhost:10443',
  dbUrl: process.env.DATABASE_URL || 'postgresql://elara:elara@localhost:5432/elara',
  env: process.env.NODE_ENV || 'development',
};
