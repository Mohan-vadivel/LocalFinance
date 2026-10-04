import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

/** Errors carry an i18n key in `code` so the apps can show them in the user's language. */
export const bad = (message: string, code = 'errors.validation') => new BadRequestException({ message, code });
export const forbidden = (message = 'You do not have permission for this', code = 'errors.forbidden') =>
  new ForbiddenException({ message, code });
export const notFound = (what = 'Record') => new NotFoundException({ message: `${what} not found`, code: 'errors.notFound' });
export const conflict = (message: string, code = 'errors.validation') => new ConflictException({ message, code });

/** Runs shared business rules (loan maths) and turns their plain errors into a 400 the apps can show. */
export function rule<T>(fn: () => T, code = 'errors.validation'): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Error && !(e as { getStatus?: unknown }).getStatus) throw bad(e.message, code);
    throw e;
  }
}
