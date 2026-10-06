import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { SOCKET_EVENTS } from './socket-events';
import { PrismaService } from '../prisma/prisma.service';
import { JourneyTrackingService } from './journey-tracking.service';

@Injectable()
@WebSocketGateway()
export class TripsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
    private prisma: PrismaService,
    private tracking: JourneyTrackingService,
  ) {}

  handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string) ||
      (client.handshake.query?.token as string);
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      client.data.userId = payload.sub;
      client.data.role = payload.role;
      client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect();
    }
  }

  @SubscribeMessage('trip:join')
  async joinTripRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() tripId: string,
  ) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { driver: true },
    });
    const userId = client.data.userId;
    const isMember =
      trip && (trip.passengerId === userId || trip.driver?.userId === userId);
    if (!isMember) return;
    client.join(`trip:${tripId}`);
  }

  @SubscribeMessage('delivery:join')
  async joinDeliveryRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() deliveryId: string,
  ) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { rider: true },
    });
    const userId = client.data.userId;
    const isMember =
      delivery &&
      (delivery.senderId === userId || delivery.rider?.userId === userId);
    if (!isMember) return;
    client.join(`delivery:${deliveryId}`);
  }

  // Widened to accept either a trip or a delivery reference, rather than a second handler --
  // it's the same relay logic and the same event either way, just a different room.
  @SubscribeMessage(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE)
  async relayDriverLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      tripId?: string;
      deliveryId?: string;
      location: { lat: number; lng: number };
      heading?: number;
    },
  ) {
    const room = data.tripId
      ? `trip:${data.tripId}`
      : data.deliveryId
        ? `delivery:${data.deliveryId}`
        : null;
    if (!room) return;
    const isAssignedDriver = await this.tracking.recordDriverLocation(
      (client.data as { userId: string }).userId,
      { tripId: data.tripId, deliveryId: data.deliveryId },
      data.location,
    );
    if (!isAssignedDriver) return;
    this.server.to(room).emit(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE, {
      tripId: data.tripId,
      deliveryId: data.deliveryId,
      driverId: client.data.userId,
      location: data.location,
      heading: data.heading,
    });
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  emitToTrip(tripId: string, event: string, payload: unknown) {
    this.server.to(`trip:${tripId}`).emit(event, payload);
  }

  emitToDelivery(deliveryId: string, event: string, payload: unknown) {
    this.server.to(`delivery:${deliveryId}`).emit(event, payload);
  }
}
