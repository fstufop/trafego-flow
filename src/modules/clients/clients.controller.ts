import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { ClientsService } from './clients.service.js';
import { ClientBillingService } from './billing/client-billing.service.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';
import { CreateClientBillingDto } from './dto/create-client-billing.dto.js';
import { RenewClientBillingDto } from './dto/renew-client-billing.dto.js';

@ApiTags('clients')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(AuthGuard)
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly billingService: ClientBillingService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new client' })
  create(@Body() dto: CreateClientDto) {
    return this.clientsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all active clients' })
  findAll() {
    return this.clientsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a client by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a client' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClientDto) {
    return this.clientsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete a client' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientsService.remove(id);
  }

  @Delete(':id/cache')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Invalidate cached data for a client' })
  clearCache(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientsService.clearCache(id);
  }

  // ── Billing ───────────────────────────────────────────────────────────────

  @Post(':id/billing')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a contract for a client' })
  createBilling(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateClientBillingDto,
  ) {
    return this.billingService.createBilling(id, dto);
  }

  @Get(':id/billing')
  @ApiOperation({ summary: 'List all contracts for a client' })
  listBillings(@Param('id', ParseUUIDPipe) id: string) {
    return this.billingService.listBillings(id);
  }

  @Get(':id/billing/active')
  @ApiOperation({ summary: 'Get the active contract for a client' })
  getActiveBilling(@Param('id', ParseUUIDPipe) id: string) {
    return this.billingService.getActiveBilling(id);
  }

  @Post(':id/billing/:billingId/renew')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Renew a contract' })
  renewBilling(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('billingId', ParseUUIDPipe) billingId: string,
    @Body() dto: RenewClientBillingDto,
  ) {
    return this.billingService.renewBilling(id, billingId, dto);
  }

  @Patch(':id/billing/:billingId/cancel')
  @ApiOperation({ summary: 'Cancel a contract' })
  cancelBilling(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('billingId', ParseUUIDPipe) billingId: string,
  ) {
    return this.billingService.cancelBilling(id, billingId);
  }

  @Patch(':id/billing/:billingId/installments/:installmentId/pay')
  @ApiOperation({ summary: 'Mark an installment as paid' })
  payInstallment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('billingId', ParseUUIDPipe) billingId: string,
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
  ) {
    return this.billingService.payInstallment(id, billingId, installmentId);
  }
}
