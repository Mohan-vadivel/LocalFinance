"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FilesController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const fs_1 = require("fs");
const path_1 = require("path");
const crypto_1 = require("crypto");
const context_1 = require("../common/context");
const errors_1 = require("../common/errors");
const scope_1 = require("../common/scope");
const prisma_service_1 = require("../common/prisma.service");
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 10 * 1024 * 1024;
const dir = () => (0, path_1.resolve)(process.env.UPLOAD_DIR ?? './uploads');
/**
 * KYC photos, ID proofs, bills and agreements. Files are private: they are served only to logged-in staff of
 * the same business. Swap the disk for S3-compatible storage by changing these two handlers.
 */
let FilesController = class FilesController {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async upload(ctx, file, body) {
        if (!file)
            throw (0, errors_1.bad)('Choose a file');
        if (!ALLOWED.includes(file.mimetype))
            throw (0, errors_1.bad)('Only JPG, PNG, WEBP or PDF files');
        await (0, scope_1.assertOwned)(this.prisma.customer, ctx, body.customerId, 'Customer');
        await (0, scope_1.assertOwned)(this.prisma.loan, ctx, body.loanId, 'Loan');
        await (0, scope_1.assertOwned)(this.prisma.investor, ctx, body.investorId, 'Investor');
        const id = (0, crypto_1.randomUUID)();
        const tenantDir = (0, path_1.join)(dir(), ctx.tenantId);
        (0, fs_1.mkdirSync)(tenantDir, { recursive: true });
        const path = (0, path_1.join)(tenantDir, id);
        (0, fs_1.writeFileSync)(path, file.buffer);
        const doc = await this.prisma.document.create({
            data: {
                id,
                tenantId: ctx.tenantId,
                kind: (body.kind ?? 'OTHER').slice(0, 40),
                customerId: body.customerId || null,
                loanId: body.loanId || null,
                investorId: body.investorId || null,
                fileName: file.originalname.slice(0, 200),
                mimeType: file.mimetype,
                path,
                size: file.size,
                createdBy: ctx.userId,
            },
        });
        return { id: doc.id, url: `/files/${doc.id}`, fileName: doc.fileName, mimeType: doc.mimeType };
    }
    async get(ctx, id, res) {
        const doc = await this.prisma.document.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (!doc || !(0, fs_1.existsSync)(doc.path))
            throw (0, errors_1.notFound)('File');
        res.setHeader('Content-Type', doc.mimeType);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.fileName)}"`);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        (0, fs_1.createReadStream)(doc.path).pipe(res);
    }
};
exports.FilesController = FilesController;
__decorate([
    (0, common_1.Post)(),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', { limits: { fileSize: MAX_BYTES } })),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.UploadedFile)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "upload", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "get", null);
exports.FilesController = FilesController = __decorate([
    (0, common_1.Controller)('files'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], FilesController);
//# sourceMappingURL=files.js.map