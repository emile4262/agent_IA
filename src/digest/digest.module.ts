import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Article, ArticleSchema } from '../articles/schemas/article.schema';
import { MailModule } from '../mail/mail.module';
import { SourcesModule } from '../sources/sources.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdminDigestController, DigestController } from './digest.controller';
import { DigestService } from './digest.service';
import { Delivery, DeliverySchema } from './schemas/delivery.schema';
import { UnsubscribeController } from './unsubscribe.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Delivery.name, schema: DeliverySchema },
      { name: Article.name, schema: ArticleSchema },
      { name: User.name, schema: UserSchema },
    ]),
    SourcesModule,
    MailModule,
  ],
  controllers: [DigestController, AdminDigestController, UnsubscribeController],
  providers: [DigestService],
})
export class DigestModule {}
