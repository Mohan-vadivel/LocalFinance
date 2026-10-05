import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuditService } from './common/audit.service';
import { AuthGuard } from './common/auth.guard';
import { BooksService } from './common/books.service';
import { NotifyService } from './common/notify.service';
import { PrismaService } from './common/prisma.service';
import { AuthController, AuthService } from './modules/auth';
import { CollectionsController, CollectionsService } from './modules/collections';
import { CustomersController, CustomersService } from './modules/customers';
import { FilesController } from './modules/files';
import { ImportsController, ImportsService } from './modules/imports';
import { LoansController, LoansService } from './modules/loans';
import {
  DaybookController,
  DaybookService,
  FundsController,
  FundsService,
  HandoverController,
  HandoverService,
  InvestorsController,
  InvestorsService,
} from './modules/money';
import { DashboardService, ProfitLossService, ReportsController, ReportsService } from './modules/reports';
import { StaffController, StaffService } from './modules/staff';
import { StructureController, StructureService } from './modules/structure';
import { SettingsController, TenantsController, TenantsService } from './modules/tenants';
import { HealthController } from './health';

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 16) {
  throw new Error('Set JWT_SECRET (at least 16 characters) in the environment');
}

@Module({
  imports: [JwtModule.register({ secret, signOptions: { expiresIn: '15m' } })],
  controllers: [
    HealthController,
    AuthController,
    TenantsController,
    SettingsController,
    StructureController,
    StaffController,
    CustomersController,
    LoansController,
    CollectionsController,
    FundsController,
    InvestorsController,
    DaybookController,
    HandoverController,
    ReportsController,
    FilesController,
    ImportsController,
  ],
  providers: [
    PrismaService,
    AuditService,
    BooksService,
    NotifyService,
    { provide: APP_GUARD, useClass: AuthGuard },
    AuthService,
    TenantsService,
    StructureService,
    StaffService,
    CustomersService,
    CollectionsService,
    LoansService,
    FundsService,
    InvestorsService,
    DaybookService,
    HandoverService,
    ProfitLossService,
    ReportsService,
    DashboardService,
    ImportsService,
  ],
})
export class AppModule {}
