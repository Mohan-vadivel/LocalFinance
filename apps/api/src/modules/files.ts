import { Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { mkdirSync, writeFileSync, existsSync, createReadStream } from 'fs';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';
import { CurrentCtx, type Ctx } from '../common/context';
import { bad, notFound } from '../common/errors';
import { assertOwned } from '../common/scope';
import { PrismaService } from '../common/prisma.service';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 10 * 1024 * 1024;
const dir = () => resolve(process.env.UPLOAD_DIR ?? './uploads');

/**
 * KYC photos, ID proofs, bills and agreements. Files are private: they are served only to logged-in staff of
 * the same business. Swap the disk for S3-compatible storage by changing these two handlers.
 */
@Controller('files')
export class FilesController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async upload(
    @CurrentCtx() ctx: Ctx,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { kind?: string; customerId?: string; loanId?: string; investorId?: string },
  ) {
    if (!file) throw bad('Choose a file');
    if (!ALLOWED.includes(file.mimetype)) throw bad('Only JPG, PNG, WEBP or PDF files');
    await assertOwned(this.prisma.customer, ctx, body.customerId, 'Customer');
    await assertOwned(this.prisma.loan, ctx, body.loanId, 'Loan');
    await assertOwned(this.prisma.investor, ctx, body.investorId, 'Investor');
    const id = randomUUID();
    const tenantDir = join(dir(), ctx.tenantId);
    mkdirSync(tenantDir, { recursive: true });
    const path = join(tenantDir, id);
    writeFileSync(path, file.buffer);
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

  @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Res() res: Response) {
    const doc = await this.prisma.document.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!doc || !existsSync(doc.path)) throw notFound('File');
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.fileName)}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    createReadStream(doc.path).pipe(res);
  }
}
