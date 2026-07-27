import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UserEntity } from './entities/user.entity.js';
import {
  IAuthService,
  JwtPayload,
  LoginResult,
} from './interfaces/auth-service.interface.js';
import { LoginDto } from './dto/login.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService implements IAuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repo: Repository<UserEntity>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.repo.findOne({
      where: { email: dto.email, isActive: true },
    });
    const passwordMatches =
      user && (await bcrypt.compare(dto.password, user.passwordHash));

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
    };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      tokenType: 'Bearer',
      expiresIn: this.config.get<string>('auth.jwtExpiresIn')!,
      user,
    };
  }

  async createUser(dto: CreateUserDto): Promise<UserEntity> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    try {
      return await this.repo.save(
        this.repo.create({ name: dto.name, email: dto.email, passwordHash }),
      );
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { code: string }).code === '23505'
      ) {
        throw new ConflictException('A user with this email already exists');
      }
      throw err;
    }
  }

  async findById(id: string): Promise<UserEntity> {
    const user = await this.repo.findOne({ where: { id, isActive: true } });
    if (!user)
      throw new UnauthorizedException('User no longer exists or is inactive');
    return user;
  }
}
