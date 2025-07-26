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
  const sessionTtl = 30 * 24 * 60 * 60 * 1000; // 30 days
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

  // Get all domains from environment
  const domains = process.env.REPLIT_DOMAINS?.split(',') || [];
  
  // Always include production domain
  if (!domains.includes('apc-planner.replit.app')) {
    domains.push('apc-planner.replit.app');
  }
  
  console.log("Available domains for callbacks:", domains);
  
  // Create a strategy for each domain
  domains.forEach((domain) => {
    const callbackURL = `https://${domain}/api/auth/slack/callback`;
    console.log("Registering callback URL:", callbackURL);
    
    // Slack OAuth Strategy
    const strategy = new SlackStrategy({
      clientID: process.env.SLACK_CLIENT_ID!,
      clientSecret: process.env.SLACK_CLIENT_SECRET!,
      callbackURL: callbackURL,
      scope: ['identity.basic', 'identity.email', 'identity.team', 'identity.avatar'],
      skipUserProfile: false,
      passReqToCallback: false
    }, async (accessToken: string, refreshToken: string, profile: any, done: any) => {
    try {
      console.log("=== SLACK STRATEGY SUCCESS ===");
      console.log("Access Token:", accessToken ? "Present" : "Missing");
      console.log("Profile:", JSON.stringify(profile, null, 2));
      
      if (!profile || !profile.user) {
        console.error("No profile data received");
        return done(new Error("No profile data received"), null);
      }
      
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
  });
  
  // Add debugging for OAuth2 token exchange
  const oauth2 = (strategy as any)._oauth2;
  const originalGetOAuthAccessToken = oauth2.getOAuthAccessToken;
  
  oauth2.getOAuthAccessToken = function(code: string, params: any, callback: any) {
    console.log("=== OAUTH2 TOKEN EXCHANGE ===");
    console.log("Token URL:", this._getAccessTokenUrl());
    console.log("Client ID:", this._clientId);
    console.log("Client Secret exists:", !!this._clientSecret);
    console.log("Client Secret first 10 chars:", this._clientSecret?.substring(0, 10));
    console.log("Authorization code:", code);
    console.log("Params:", params);
    console.log("Full token request URL:", this._getAccessTokenUrl() + "?" + 
      "client_id=" + this._clientId + 
      "&client_secret=" + (this._clientSecret ? "[REDACTED]" : "MISSING") +
      "&code=" + code +
      "&redirect_uri=" + (params.redirect_uri || "NOT_SET"));
    
    return originalGetOAuthAccessToken.call(this, code, params, (error: any, accessToken: any, refreshToken: any, results: any) => {
      if (error) {
        console.error("Token exchange error:", error);
        console.error("Error data:", error.data);
      } else {
        console.log("Token exchange success!");
        console.log("Access Token:", accessToken ? "Present" : "Missing");
        console.log("Refresh Token:", refreshToken ? "Present" : "Missing");
        console.log("Results:", JSON.stringify(results, null, 2));
      }
      callback(error, accessToken, refreshToken, results);
    });
  };
  
    // Register strategy with domain-specific name
    passport.use(`slack:${domain}`, strategy);
  });
  
  // Also register default strategy for production domain
  const prodDomain = 'apc-planner.replit.app';
  const prodStrategy = new SlackStrategy({
    clientID: process.env.SLACK_CLIENT_ID!,
    clientSecret: process.env.SLACK_CLIENT_SECRET!,
    callbackURL: `https://${prodDomain}/api/auth/slack/callback`,
    scope: ['identity.basic', 'identity.email', 'identity.team', 'identity.avatar'],
    skipUserProfile: false,
    passReqToCallback: false
  }, async (accessToken: string, refreshToken: string, profile: any, done: any) => {
    try {
      console.log("=== SLACK STRATEGY SUCCESS (Production) ===");
      console.log("Access Token:", accessToken ? "Present" : "Missing");
      console.log("Profile:", JSON.stringify(profile, null, 2));
      
      if (!profile || !profile.user) {
        console.error("No profile data received");
        return done(new Error("No profile data received"), null);
      }
      
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
  });
  
  passport.use('slack', prodStrategy);

  passport.serializeUser((user: any, done) => {
    done(null, user);
  });

  passport.deserializeUser((user: any, done) => {
    done(null, user);
  });

  // Auth routes
  app.get("/api/auth/slack", (req, res, next) => {
    console.log("=== SLACK AUTH INITIATED ===");
    console.log("Host:", req.hostname);
    console.log("Full URL:", req.protocol + '://' + req.get('host') + req.originalUrl);
    
    // Use domain-specific strategy if exists, otherwise use default
    const strategyName = domains.includes(req.hostname) ? `slack:${req.hostname}` : 'slack';
    console.log("Using strategy:", strategyName);
    
    passport.authenticate(strategyName)(req, res, next);
  });

  app.get("/api/auth/slack/callback", (req, res, next) => {
    console.log("=== SLACK CALLBACK HIT ===");
    console.log("Host:", req.hostname);
    console.log("Query params:", req.query);
    console.log("Code present:", !!req.query.code);
    console.log("State present:", !!req.query.state);
    console.log("Error in query:", req.query.error);
    
    if (req.query.error) {
      console.error("OAuth error from Slack:", req.query.error);
      const errorDesc = req.query.error_description || req.query.error;
      return res.redirect("/?error=" + encodeURIComponent(errorDesc as string));
    }
    
    // Use domain-specific strategy if exists, otherwise use default
    const strategyName = domains.includes(req.hostname) ? `slack:${req.hostname}` : 'slack';
    console.log("Using strategy for callback:", strategyName);
    
    passport.authenticate(strategyName, (err: any, user: any, info: any) => {
      console.log("=== PASSPORT AUTHENTICATE CALLBACK ===");
      
      if (err) {
        console.error("Slack authentication error:", err.message || err);
        console.error("Error type:", err.constructor.name);
        console.error("Error stack:", err.stack);
        
        // Check for specific error types
        if (err.message?.includes("Failed to obtain access token")) {
          console.error("Token exchange failed. Possible issues:");
          console.error("1. Client ID/Secret mismatch");
          console.error("2. Redirect URL mismatch");
          console.error("3. Authorization code already used");
        }
        
        return res.redirect("/?error=" + encodeURIComponent(err.message || "Authentication failed"));
      }
      
      if (!user) {
        console.error("No user returned from Slack auth");
        console.error("Info object:", info);
        return res.redirect("/?error=" + encodeURIComponent(info?.message || "No user data received"));
      }
      
      console.log("User data received, logging in...");
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          console.error("Login error:", loginErr);
          return res.redirect("/?error=" + encodeURIComponent("Login failed"));
        }
        console.log("User successfully logged in:", user.id);
        return res.redirect("/");
      });
    })(req, res, next);
  });

  // Test endpoint
  app.get("/api/auth/test", (req, res) => {
    res.json({ 
      message: "Auth endpoints are working",
      slackConfigured: !!process.env.SLACK_CLIENT_ID && !!process.env.SLACK_CLIENT_SECRET
    });
  });

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