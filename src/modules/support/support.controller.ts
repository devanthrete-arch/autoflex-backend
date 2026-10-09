import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Query,
  HttpCode,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { TransactionalCommand } from '../idempotency/transactional-command.decorator';
import { commandMeta, type CommandRequest } from './support-command';
import {
  SupportHistoryQueryDto,
  SupportMessageDto,
} from './dto/support-workflow.dto';
import { SupportWorkflowService } from './support-workflow.service';
import { CreateSupportRequestDto } from './dto/support.dto';
import { SupportService, type SupportRequestView } from './support.service';

@ApiTags('me')
@ApiBearerAuth()
@RequireCustomer()
@Controller('v1/me/support-requests')
export class SupportController {
  constructor(
    private readonly support: SupportService,
    private readonly workflow: SupportWorkflowService,
  ) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<SupportRequestView[]> {
    return this.support.list(auth);
  }

  @Post()
  @TransactionalCommand()
  @ApiOperation({ summary: 'Ask for help; returns an SR reference' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateSupportRequestDto,
    @Req() req: CommandRequest,
  ): Promise<SupportRequestView> {
    return this.support.create(auth, dto, commandMeta(req, dto, 201, true));
  }

  @Get(':id/events')
  events(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SupportHistoryQueryDto,
  ) {
    return this.support.events(auth, id, query);
  }

  @Post(':id/replies')
  @HttpCode(200)
  @TransactionalCommand()
  reply(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportMessageDto,
    @Req() req: CommandRequest,
  ) {
    return this.workflow.command(
      auth,
      id,
      'customerReply',
      body,
      commandMeta(req, body),
    );
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupportRequestView> {
    return this.support.get(auth, id);
  }
}
