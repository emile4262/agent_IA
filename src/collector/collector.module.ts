import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ArticlesService } from '../articles/articles.service';
import { Article, ArticleSchema } from '../articles/schemas/article.schema';
import { SourcesModule } from '../sources/sources.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdminCollectorController } from './admin-collector.controller';
import { CollectorService } from './collector.service';
import { SummarizerService } from './summarizer.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Article.name, schema: ArticleSchema },
      { name: User.name, schema: UserSchema },
    ]),
    SourcesModule,
  ],
  controllers: [AdminCollectorController],
  providers: [CollectorService, SummarizerService, ArticlesService],
  exports: [ArticlesService],
})
export class CollectorModule {}
