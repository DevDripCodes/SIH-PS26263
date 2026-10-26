/** An error with an HTTP status whose message is safe to show to the user. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
