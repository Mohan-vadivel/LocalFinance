"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnyUser = exports.SuperAdminOnly = exports.SUPER_KEY = exports.Perm = exports.PERMS_KEY = exports.Public = exports.PUBLIC_KEY = exports.CurrentCtx = void 0;
const common_1 = require("@nestjs/common");
exports.CurrentCtx = (0, common_1.createParamDecorator)((_, ec) => ec.switchToHttp().getRequest().ctx);
exports.PUBLIC_KEY = 'isPublic';
const Public = () => (0, common_1.SetMetadata)(exports.PUBLIC_KEY, true);
exports.Public = Public;
exports.PERMS_KEY = 'perms';
/** Requires any one of the listed permissions. */
const Perm = (...perms) => (0, common_1.SetMetadata)(exports.PERMS_KEY, perms);
exports.Perm = Perm;
exports.SUPER_KEY = 'superOnly';
const SuperAdminOnly = () => (0, common_1.SetMetadata)(exports.SUPER_KEY, true);
exports.SuperAdminOnly = SuperAdminOnly;
/** Allows any logged-in user, including a Super Admin with no business open. */
const AnyUser = () => (0, common_1.SetMetadata)('anyUser', true);
exports.AnyUser = AnyUser;
//# sourceMappingURL=context.js.map