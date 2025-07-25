// @ts-ignore - No types available for passport-slack-oauth2
import { Strategy as SlackStrategy } from "passport-slack-oauth2";
import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

if (!process.env.REPLIT_DOMAINS) {
  throw new Error("Environment variable REPLIT_DOMAINS not provided");
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
    },
  });
}

async function upsertUser(profile: any) {
  await storage.upsertUser({
    id: profile.user.id,
    email: profile.user.email,
    firstName: profile.user.real_name?.split(' ')[0] || profile.user.name,
    lastName: profile.user.real_name?.split(' ').slice(1).join(' ') || null,
    profileImageUrl: profile.user.image_192,
  });
}

export async function setupSlackAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Debug logging
  console.log("Slack OAuth Configuration:", {
    clientID: process.env.SLACK_CLIENT_ID ? "Set" : "Missing",
    clientSecret: process.env.SLACK_CLIENT_SECRET ? "Set" : "Missing",
    callbackURL: `https://apc-planner.replit.app/api/auth/slack/callback`
  });

  // Slack OAuth Strategy
  passport.use('slack', new SlackStrategy({
    clientID: process.env.SLACK_CLIENT_ID!,
    clientSecret: process.env.SLACK_CLIENT_SECRET!,
    callbackURL: `https://apc-planner.replit.app/api/auth/slack/callback`,
    scope: ['identity.basic', 'identity.email', 'identity.team', 'identity.avatar'],
    skipUserProfile: false
  }, async (accessToken: string, refreshToken: string, profile: any, done: any) => {
    try {
      console.log("Slack profile received:", JSON.stringify(profile, null, 2));
      
      // Create user object for session
      const user = {
        id: profile.user.id,
        email: profile.user.email,
        name: profile.user.real_name || profile.user.name,
        image: profile.user.image_192,
        team: profile.team.id,
        teamName: profile.team.name,
        accessToken
      };
      
      // Store user in database
      await upsertUser(profile);
      
      return done(null, user);
    } catch (error) {
      console.error("Error in Slack auth callback:", error);
      return done(error, null);
    }
  }));

  passport.serializeUser((user: any, done) => {
    done(null, user);
  });

  passport.deserializeUser((user: any, done) => {
    done(null, user);
  });

  // Auth routes
  app.get("/api/auth/slack", 
    passport.authenticate("slack")
  );

  app.get("/api/auth/slack/callback",
    passport.authenticate("slack", {
      successRedirect: "/",
      failureRedirect: "/login",
      failureMessage: true
    }),
    (err: any, req: any, res: any, next: any) => {
      if (err) {
        console.error("Slack OAuth callback error:", err);
        return res.redirect("/login?error=" + encodeURIComponent(err.message));
      }
      next();
    }
  );

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect("/");
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  return next();
};