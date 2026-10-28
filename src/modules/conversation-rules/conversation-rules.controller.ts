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
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ClientPortalAuthGuard } from '../../common/guards/client-portal-auth.guard.js';
import { ClientPortalScopeGuard } from '../auth/guards/client-portal-scope.guard.js';
import { ConversationRulesService } from './conversation-rules.service.js';
import { CreateConversationRuleDto } from './dto/create-conversation-rule.dto.js';
import { UpdateConversationRuleDto } from './dto/update-conversation-rule.dto.js';
import { GetPostsQueryDto } from './dto/get-posts-query.dto.js';

@ApiTags('conversation-rules')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(ClientPortalAuthGuard)
@Controller('conversation-rules')
export class ConversationRulesController {
  constructor(private readonly rulesService: ConversationRulesService) {}

  @Get('posts')
  @ApiOperation({
    summary:
      'Listar posts recentes da página (para usar como triggerValue), paginado por cursor',
  })
  getPosts(@Query() query: GetPostsQueryDto) {
    return this.rulesService.getRecentPosts(
      query.pageId,
      query.limit,
      query.after,
    );
  }

  @Post()
  @UseGuards(ClientPortalScopeGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Criar regra de auto-reply' })
  create(@Body() dto: CreateConversationRuleDto) {
    return this.rulesService.create(dto);
  }

  @Get()
  @UseGuards(ClientPortalScopeGuard)
  @ApiOperation({ summary: 'Listar regras ativas de um cliente' })
  @ApiQuery({ name: 'clientId', required: true, type: String })
  findAll(@Query('clientId', ParseUUIDPipe) clientId: string) {
    return this.rulesService.findAll(clientId);
  }

  @Patch(':id')
  @UseGuards(ClientPortalScopeGuard)
  @ApiOperation({ summary: 'Atualizar regra (reply, isActive, triggerValue)' })
  @ApiQuery({ name: 'clientId', required: true, type: String })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: UpdateConversationRuleDto,
  ) {
    return this.rulesService.update(id, clientId, dto);
  }

  @Delete(':id')
  @UseGuards(ClientPortalScopeGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover regra (soft delete)' })
  @ApiQuery({ name: 'clientId', required: true, type: String })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.rulesService.remove(id, clientId);
  }
}
