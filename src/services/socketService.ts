import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import { UserModel } from '../models';
import dotenv from 'dotenv';

dotenv.config();

export class SocketService {
  private static instance: SocketService;
  private io: SocketServer | null = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  private constructor() { }

  public static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService();
    }
    return SocketService.instance;
  }

  public async initialize(httpServer: HttpServer): Promise<void> {
    this.io = new SocketServer(httpServer, {
      cors: {
        origin: '*', // Adjust this in production
        methods: ['GET', 'POST'],
      },
    });

    // Setup Redis adapter for scalability
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.pubClient = new Redis(redisUrl);
    this.subClient = this.pubClient.duplicate();

    this.io.adapter(createAdapter(this.pubClient, this.subClient));

    // Middleware for authentication
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers['authorization'];

        if (!token) {
          return next(new Error('Authentication error: No token provided'));
        }

        const decoded = jwt.verify(
          token.replace('Bearer ', ''),
          process.env.JWT_SECRET || 'secret'
        ) as { userId: string };

        const user = await UserModel.findById(decoded.userId);
        if (!user) {
          return next(new Error('Authentication error: User not found'));
        }

        (socket as any).user = user;
        next();
      } catch (err) {
        console.error('Socket authentication error:', err);
        next(new Error('Authentication error: Invalid token'));
      }
    });

    this.io.on('connection', (socket) => {
      const user = (socket as any).user;
      console.log(`User connected: ${user.id} (${user.email})`);

      // Join a room specific to this user
      socket.join(`user_${user.id}`);

      socket.on('disconnect', () => {
        console.log(`User disconnected: ${user.id}`);
      });
    });

    console.log('Socket.io initialized with Redis adapter');
  }

  public emitToUser(userId: string, event: string, data: any): void {
    if (this.io) {
      this.io.to(`user_${userId}`).emit(event, data);
    }
  }

  public emitToRoom(room: string, event: string, data: any): void {
    if (this.io) {
      this.io.to(room).emit(event, data);
    }
  }

  public broadcast(event: string, data: any): void {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  public async isUserOnline(userId: string): Promise<boolean> {
    if (!this.io) return false;
    const room = this.io.sockets.adapter.rooms.get(`user_${userId}`);
    return !!room && room.size > 0;
  }
}

export default SocketService.getInstance();
