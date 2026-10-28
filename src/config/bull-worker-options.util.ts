import { WorkerOptions } from 'bullmq';

/**
 * Tuned for low/bursty traffic queues (webhook/media-upload workers embedded
 * in the API process). BullMQ's defaults (drainDelay: 5s, stalledInterval:
 * 30s) poll Redis continuously even when the queue is empty, which is the
 * main driver of idle Redis command usage on a metered plan. New jobs still
 * wake the worker immediately — BullMQ's blocking pop unblocks on push
 * regardless of drainDelay — so this only slows down idle polling and
 * stalled-job detection, not real job pickup latency.
 */
export const lowTrafficWorkerOptions: Partial<WorkerOptions> = {
  drainDelay: 300,
  stalledInterval: 120_000,
};
