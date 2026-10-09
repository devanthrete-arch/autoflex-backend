import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { RequireSupport } from '../auth/decorators/require-support.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { TransactionalCommand } from '../idempotency/transactional-command.decorator';
import { commandMeta, type CommandRequest } from './support-command';
import { SupportOperatorService } from './support-operator.service';
import { SupportWorkflowService } from './support-workflow.service';
import {
  SupportEmptyDto,
  SupportAssignDto,
  SupportReasonDto,
  SupportMessageDto,
  SupportPublicReplyDto,
  SupportWaitDto,
  SupportPriorityDto,
  SupportResolveDto,
  SupportExplanationDto,
  SupportHistoryQueryDto,
  SupportQueueQueryDto,
  SupportRosterQueryDto,
} from './dto/support-workflow.dto';

@ApiTags('support')
@ApiBearerAuth()
@RequireSupport()
@Permissions('support:read')
@Controller('v1/support')
export class SupportOperatorController {
  constructor(
    private readonly reads: SupportOperatorService,
    private readonly workflow: SupportWorkflowService,
  ) {}
  @Get('me') me(@CurrentAuth() auth: AuthContext) {
    return this.reads.me(auth);
  }
  @Get('agents') roster(
    @CurrentAuth() auth: AuthContext,
    @Query() query: SupportRosterQueryDto,
  ) {
    return this.reads.roster(auth, query.includeInactive === 'true');
  }
  @Get('requests/summary') summary(
    @CurrentAuth() auth: AuthContext,
    @Query() query: SupportQueueQueryDto,
  ) {
    return this.reads.summary(auth, query);
  }
  @Get('requests') list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: SupportQueueQueryDto,
  ) {
    return this.reads.list(auth, query);
  }
  @Get('requests/:id/events') events(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SupportHistoryQueryDto,
  ) {
    return this.reads.events(auth, id, query);
  }
  @Get('requests/:id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.reads.get(id);
  }
  @Post('requests/:id/claim')
  @HttpCode(200)
  @TransactionalCommand()
  claim(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportEmptyDto,
    @Req() req: CommandRequest,
  ) {
    return this.workflow.command(
      auth,
      id,
      'claim',
      body,
      commandMeta(req, body),
    );
  }
  @Post('requests/:id/assign')
  @HttpCode(200)
  @TransactionalCommand()
  assign(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportAssignDto,
    @Req() req: CommandRequest,
  ) {
    return this.workflow.command(
      auth,
      id,
      'assign',
      body,
      commandMeta(req, body),
    );
  }
  @Post('requests/:id/release')
  @HttpCode(200)
  @TransactionalCommand()
  release(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportReasonDto,
    @Req() req: CommandRequest,
  ) {
    return this.workflow.command(
      auth,
      id,
      'release',
      body,
      commandMeta(req, body),
    );
  }
  @Post('requests/:id/notes')
  @HttpCode(200)
  @TransactionalCommand()
  notes(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportMessageDto,
    @Req() req: CommandRequest,
  ) {
    return this.workflow.command(
      auth,
      id,
      'notes',
      body,
      commandMeta(req, body),
    );
  }
  @Post('requests/:id/replies')
  @HttpCode(200)
  @TransactionalCommand()
  replies(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportPublicReplyDto,
    @Req() req: CommandRequest,
  ) {
    return this.workflow.command(
      auth,
      id,
      'replies',
      body,
      commandMeta(req, body),
    );
  }
  @Post('requests/:id/wait')
  @HttpCode(200)
  @TransactionalCommand()
  wait(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportWaitDto,
    @Req() req: CommandRequest,
  ) {
    return this.workflow.command(
      auth,
      id,
      'wait',
      body,
      commandMeta(req, body),
    );
  }
  @Post('requests/:id/priority')
  @HttpCode(200)
  @TransactionalCommand()
  priority(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportPriorityDto,
    @Req() req: CommandRequest,
  ) {
    return this.workflow.command(
      auth,
      id,
      'priority',
      body,
      commandMeta(req, body),
    );
  }
  @Post('requests/:id/resolve')
  @HttpCode(200)
  @TransactionalCommand()
  resolve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportResolveDto,
    @Req() req: CommandRequest,
  ) {
    return this.workflow.command(
      auth,
      id,
      'resolve',
      body,
      commandMeta(req, body),
    );
  }
  @Post('requests/:id/close')
  @HttpCode(200)
  @TransactionalCommand()
  close(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportExplanationDto,
    @Req() req: CommandRequest,
  ) {
    return this.workflow.command(
      auth,
      id,
      'close',
      body,
      commandMeta(req, body),
    );
  }
  @Post('requests/:id/reopen')
  @HttpCode(200)
  @TransactionalCommand()
  reopen(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportExplanationDto,
    @Req() req: CommandRequest,
  ) {
    return this.workflow.command(
      auth,
      id,
      'reopen',
      body,
      commandMeta(req, body),
    );
  }
}
