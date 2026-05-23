import logging

from fastapi import HTTPException, status


logger = logging.getLogger(__name__)


# Shared client-safe API error mapping for route boundaries. Unexpected details
# stay in server logs; clients receive stable messages.
class AppError(Exception):
    status_code = status.HTTP_400_BAD_REQUEST

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT


class InvalidStateError(AppError):
    status_code = status.HTTP_409_CONFLICT


class ForbiddenBusinessActionError(AppError):
    status_code = status.HTTP_403_FORBIDDEN


class IntegrationFailureError(AppError):
    status_code = status.HTTP_502_BAD_GATEWAY


def bad_request_error(exc: ValueError | AppError) -> HTTPException:
    if isinstance(exc, AppError):
        return HTTPException(status_code=exc.status_code, detail=exc.message)
    return HTTPException(status_code=400, detail=str(exc))


def not_found_error(exc: ValueError | AppError) -> HTTPException:
    if isinstance(exc, AppError):
        return HTTPException(status_code=exc.status_code, detail=exc.message)
    return HTTPException(status_code=404, detail=str(exc))


def internal_server_error(exc: Exception, *, context: str) -> HTTPException:
    logger.exception("%s failed: %s", context, exc)
    return HTTPException(
        status_code=500,
        detail="Internal server error.",
    )
