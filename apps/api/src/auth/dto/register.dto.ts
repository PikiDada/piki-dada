import { IsEmail, IsIn, IsString, Matches, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';

// Public self-registration may only create PASSENGER or DRIVER accounts.
// ADMIN accounts must be provisioned separately (e.g. directly in the DB) —
// allowing UserRole.ADMIN here would let anyone grant themselves admin access.
const SELF_REGISTERABLE_ROLES = [UserRole.PASSENGER, UserRole.DRIVER] as const;

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  name: string;

  @IsString()
  @Matches(/^\+?[0-9 ()-]{7,20}$/, {
    message: 'phone must be a valid phone number',
  })
  phone: string;

  @IsIn(SELF_REGISTERABLE_ROLES)
  role: (typeof SELF_REGISTERABLE_ROLES)[number];
}
