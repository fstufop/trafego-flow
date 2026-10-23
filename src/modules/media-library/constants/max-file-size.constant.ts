export const MAX_FILE_SIZE_BYTES =
  parseInt(process.env.MAX_FILE_SIZE_MB ?? '500', 10) * 1024 * 1024;
