/**
 * Erro com status HTTP e código estável para o frontend. Erro que não é AppError
 * tem a mensagem suprimida pelo errorHandler (nada de stack ou detalhe do driver).
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, statusCode = 400, code = 'APP_ERROR', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(message, 400, 'BAD_REQUEST', details);
  }

  static unauthorized(message = 'Não autenticado.'): AppError {
    return new AppError(message, 401, 'UNAUTHORIZED');
  }

  static forbidden(message = 'Acesso negado.'): AppError {
    return new AppError(message, 403, 'FORBIDDEN');
  }

  static notFound(message = 'Recurso não encontrado.'): AppError {
    return new AppError(message, 404, 'NOT_FOUND');
  }

  static conflict(message: string): AppError {
    return new AppError(message, 409, 'CONFLICT');
  }

  static tooManyRequests(message = 'Muitas requisições. Tente novamente em instantes.'): AppError {
    return new AppError(message, 429, 'TOO_MANY_REQUESTS');
  }

  static unprocessable(message: string, details?: unknown): AppError {
    return new AppError(message, 422, 'UNPROCESSABLE_ENTITY', details);
  }

  static internal(message = 'Erro interno.'): AppError {
    return new AppError(message, 500, 'INTERNAL_ERROR');
  }

  static badGateway(message = 'Serviço externo indisponível.', details?: unknown): AppError {
    return new AppError(message, 502, 'BAD_GATEWAY', details);
  }
}
