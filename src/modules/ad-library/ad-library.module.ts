import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AdLibraryController } from './ad-library.controller.js';
import { AdLibraryService } from './ad-library.service.js';

@Module({
  imports: [HttpModule],
  controllers: [AdLibraryController],
  providers: [AdLibraryService],
})
export class AdLibraryModule {}
