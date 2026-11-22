import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Delivery, DeliverySchema } from '../digest/schemas/delivery.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdminDashboardController } from './admin-dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Delivery.name, schema: DeliverySchema },
    ]),
  ],
  controllers: [AdminDashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
