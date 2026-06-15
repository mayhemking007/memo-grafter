export const logger = {
  info(message: string): void {
    console.log(message);
  },
  success(message: string): void {
    console.log(`✓ ${message}`);
  },
  warn(message: string): void {
    console.warn(`! ${message}`);
  },
  error(message: string): void {
    console.error(`Error: ${message}`);
  },
};
