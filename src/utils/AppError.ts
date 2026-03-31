/**
 * Typed error that carries an HTTP status code.
 * Throw from services — controllers pass it to next(err),
 * and errorHandler maps statusCode to the response.
 */
export class AppError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
