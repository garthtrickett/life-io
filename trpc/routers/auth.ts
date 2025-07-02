// File: trpc/routers/auth.ts
import { router } from "../trpc";
import { signupProcedure } from "../../features/auth/procedures/signup";
import { loginProcedure } from "../../features/auth/procedures/login";
import { logoutProcedure } from "../../features/auth/procedures/logout";
import { meProcedure } from "../../features/auth/procedures/me";
import { changePasswordProcedure } from "../../features/auth/procedures/changePassword";
import { requestPasswordResetProcedure } from "../../features/auth/procedures/requestPasswordReset";
import { resetPasswordProcedure } from "../../features/auth/procedures/resetPassword";
import { verifyEmailProcedure } from "../../features/auth/procedures/verifyEmail";

export const authRouter = router({
  signup: signupProcedure,
  login: loginProcedure,
  logout: logoutProcedure,
  me: meProcedure,
  changePassword: changePasswordProcedure,
  requestPasswordReset: requestPasswordResetProcedure,
  resetPassword: resetPasswordProcedure,
  verifyEmail: verifyEmailProcedure,
});
