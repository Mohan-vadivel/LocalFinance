"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.conflict = exports.notFound = exports.forbidden = exports.bad = void 0;
exports.rule = rule;
const common_1 = require("@nestjs/common");
/** Errors carry an i18n key in `code` so the apps can show them in the user's language. */
const bad = (message, code = 'errors.validation') => new common_1.BadRequestException({ message, code });
exports.bad = bad;
const forbidden = (message = 'You do not have permission for this', code = 'errors.forbidden') => new common_1.ForbiddenException({ message, code });
exports.forbidden = forbidden;
const notFound = (what = 'Record') => new common_1.NotFoundException({ message: `${what} not found`, code: 'errors.notFound' });
exports.notFound = notFound;
const conflict = (message, code = 'errors.validation') => new common_1.ConflictException({ message, code });
exports.conflict = conflict;
/** Runs shared business rules (loan maths) and turns their plain errors into a 400 the apps can show. */
function rule(fn, code = 'errors.validation') {
    try {
        return fn();
    }
    catch (e) {
        if (e instanceof Error && !e.getStatus)
            throw (0, exports.bad)(e.message, code);
        throw e;
    }
}
//# sourceMappingURL=errors.js.map