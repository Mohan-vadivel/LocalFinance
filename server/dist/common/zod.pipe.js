"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.V = exports.ZodPipe = void 0;
const common_1 = require("@nestjs/common");
class ZodPipe {
    schema;
    constructor(schema) {
        this.schema = schema;
    }
    transform(value) {
        const r = this.schema.safeParse(value ?? {});
        if (!r.success) {
            throw new common_1.BadRequestException({
                message: 'Please check the highlighted fields',
                code: 'errors.validation',
                fields: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
            });
        }
        return r.data;
    }
}
exports.ZodPipe = ZodPipe;
const V = (schema) => new ZodPipe(schema);
exports.V = V;
//# sourceMappingURL=zod.pipe.js.map