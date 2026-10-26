"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const jwt_1 = require("@nestjs/jwt");
const audit_service_1 = require("./common/audit.service");
const claude_service_1 = require("./common/claude.service");
const auth_guard_1 = require("./common/auth.guard");
const books_service_1 = require("./common/books.service");
const notify_service_1 = require("./common/notify.service");
const prisma_service_1 = require("./common/prisma.service");
const ai_1 = require("./modules/ai");
const auth_1 = require("./modules/auth");
const collections_1 = require("./modules/collections");
const customers_1 = require("./modules/customers");
const files_1 = require("./modules/files");
const imports_1 = require("./modules/imports");
const loans_1 = require("./modules/loans");
const money_1 = require("./modules/money");
const platform_1 = require("./modules/platform");
const reports_1 = require("./modules/reports");
const salary_1 = require("./modules/salary");
const staff_1 = require("./modules/staff");
const structure_1 = require("./modules/structure");
const tenants_1 = require("./modules/tenants");
const health_1 = require("./health");
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 16) {
    throw new Error('Set JWT_SECRET (at least 16 characters) in the environment');
}
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [jwt_1.JwtModule.register({ secret, signOptions: { expiresIn: '15m' } })],
        controllers: [
            health_1.HealthController,
            auth_1.AuthController,
            tenants_1.TenantsController,
            tenants_1.SettingsController,
            structure_1.StructureController,
            staff_1.StaffController,
            customers_1.CustomersController,
            loans_1.LoansController,
            collections_1.CollectionsController,
            money_1.FundsController,
            money_1.InvestorsController,
            money_1.DaybookController,
            money_1.HandoverController,
            salary_1.SalaryController,
            reports_1.ReportsController,
            files_1.FilesController,
            imports_1.ImportsController,
            ai_1.AiController,
            platform_1.PlatformSettingsController,
            platform_1.SupportController,
            platform_1.PlanController,
        ],
        providers: [
            prisma_service_1.PrismaService,
            audit_service_1.AuditService,
            books_service_1.BooksService,
            notify_service_1.NotifyService,
            { provide: core_1.APP_GUARD, useClass: auth_guard_1.AuthGuard },
            auth_1.AuthService,
            tenants_1.TenantsService,
            structure_1.StructureService,
            staff_1.StaffService,
            customers_1.CustomersService,
            collections_1.CollectionsService,
            loans_1.LoansService,
            money_1.FundsService,
            money_1.InvestorsService,
            money_1.DaybookService,
            money_1.HandoverService,
            salary_1.SalaryService,
            reports_1.ProfitLossService,
            reports_1.ReportsService,
            reports_1.DashboardService,
            imports_1.ImportsService,
            claude_service_1.ClaudeService,
            ai_1.AiService,
            platform_1.PlatformService,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map