import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ClientPortalAuthGuard } from '../../common/guards/client-portal-auth.guard.js';
import { ClientPortalAuthService } from './client-portal-auth.service.js';
import { CreateClientPortalUserDto } from './dto/create-client-portal-user.dto.js';
import { SetClientPortalUserActiveDto } from './dto/set-client-portal-user-active.dto.js';
import { ClientLoginDto } from './dto/client-login.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import type { JwtPayload } from './interfaces/auth-service.interface.js';
import { UserRole } from './constants/user-role.constant.js';
import { CLIENT_PORTAL_SCOPE } from './constants/client-portal.constant.js';

@ApiTags('auth')
@Controller('auth')
export class ClientPortalAuthController {
  constructor(
    private readonly clientPortalAuthService: ClientPortalAuthService,
  ) {}

  @Post('client-portal-users')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @ApiOperation({
    summary: 'Provision a client portal account and send the invite email',
  })
  createAccount(@Body() dto: CreateClientPortalUserDto) {
    return this.clientPortalAuthService.createAccount(dto);
  }

  @Get('client-portal-users')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @ApiQuery({ name: 'clientId', required: true, type: String })
  @ApiOperation({ summary: 'Find the client portal account for a client' })
  findByClient(@Query('clientId', ParseUUIDPipe) clientId: string) {
    return this.clientPortalAuthService.findByClient(clientId);
  }

  @Patch('client-portal-users/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @ApiOperation({
    summary: 'Activate or deactivate a client portal account',
  })
  setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetClientPortalUserActiveDto,
  ) {
    return this.clientPortalAuthService.setActive(id, dto.isActive);
  }

  @Post('client-portal-users/:id/resend-invite')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @ApiOperation({
    summary: 'Resend the client portal invite/reset email',
  })
  resendInvite(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientPortalAuthService.resendInvite(id);
  }

  @Post('client-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Authenticate a client portal user and receive a JWT',
  })
  login(@Body() dto: ClientLoginDto) {
    return this.clientPortalAuthService.login(dto);
  }

  @Post('client-forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Request a client portal password reset email (always resolves identically, whether the account exists or not)',
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.clientPortalAuthService.forgotPassword(dto);
  }

  @Post('client-reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reset a client portal password using a token' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.clientPortalAuthService.resetPassword(dto);
  }

  @Get('client-portal/me')
  @UseGuards(ClientPortalAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Get the authenticated client portal user's own clientId/email (the portal reads this to discover its clientId, since the JWT lives in an httpOnly cookie and is never read in the browser)",
  })
  async me(@CurrentUser() payload: JwtPayload | undefined) {
    // ClientPortalAuthGuard also accepts the master API key and plain
    // no-scope admin JWTs (it does not set request.user for the former, and
    // sets a payload with no `scope` for the latter) — neither has a
    // sensible meaning for "my own client-portal account", so reject both
    // explicitly instead of letting them 500 (no payload) or 404 (wrong
    // principal) their way through the lookup below.
    if (!payload || payload.scope !== CLIENT_PORTAL_SCOPE) {
      throw new UnauthorizedException(
        'This endpoint requires a client-portal session',
      );
    }

    const user = await this.clientPortalAuthService.findById(payload.sub);

    return { clientId: user.clientId, email: user.email };
  }
}
