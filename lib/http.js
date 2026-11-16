// Small helpers shared by every API route.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wraps a handler: checks the HTTP method, and turns thrown errors into JSON responses.
export function handle(methods, fn) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) {
        res.setHeader('Allow', methods.join(', '));
        return res.status(405).json({ error: 'Method not allowed' });
      }
      await fn(req, res);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      res.status(status).json({
        error: status >= 500 ? 'Something went wrong on the server' : err.message,
      });
    }
  };
}
