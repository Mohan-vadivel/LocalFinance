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
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotifyService = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@localfinance/shared");
const prisma_service_1 = require("./prisma.service");
/**
 * Sends SMS through the configured provider. SMS_PROVIDER=log (default) only records the message in the
 * notifications table; SMS_PROVIDER=msg91 sends it through MSG91. Sending never blocks or fails the business
 * operation that triggered it.
 */
let NotifyService = class NotifyService {
    prisma;
    log = new common_1.Logger('Notify');
    constructor(prisma) {
        this.prisma = prisma;
    }
    async sms(tenantId, to, language, key, vars, template) {
        const body = template
            ? template.replace(/\{\{(\w+)\}\}/g, (_, v) => (vars[v] !== undefined ? String(vars[v]) : ''))
            : (0, shared_1.translate)(language, key, vars);
        const n = await this.prisma.notification.create({ data: { tenantId, channel: 'SMS', to, body } });
        void this.deliver(n.id, to, body);
        return n;
    }
    async deliver(id, to, body) {
        const provider = process.env.SMS_PROVIDER ?? 'log';
        try {
            if (provider === 'msg91' && process.env.MSG91_AUTH_KEY) {
                const res = await fetch('https://control.msg91.com/api/v5/flow/', {
                    method: 'POST',
                    headers: { authkey: process.env.MSG91_AUTH_KEY, 'content-type': 'application/json' },
                    body: JSON.stringify({ sender: process.env.MSG91_SENDER, mobiles: to.replace(/\D/g, ''), message: body }),
                });
                if (!res.ok)
                    throw new Error(`MSG91 ${res.status}`);
                await this.prisma.notification.update({ where: { id }, data: { status: 'SENT' } });
            }
            else {
                await this.prisma.notification.update({ where: { id }, data: { status: 'LOGGED' } });
            }
        }
        catch (e) {
            this.log.warn(`SMS ${id} failed: ${e.message}`);
            await this.prisma.notification.update({ where: { id }, data: { status: 'FAILED', error: e.message } }).catch(() => undefined);
        }
    }
};
exports.NotifyService = NotifyService;
exports.NotifyService = NotifyService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], NotifyService);
//# sourceMappingURL=notify.service.js.map