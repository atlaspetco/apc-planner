import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Navigation from "@/components/navigation";
import Dashboard from "@/pages/dashboard";
import OperatorSettings from "@/pages/operator-settings";
import UphAnalytics from "@/pages/uph-analytics";
import FulfilSettings from "@/pages/fulfil-settings";
import NotFound from "@/pages/not-found";
// Landing and useAuth temporarily commented out while auth is disabled
// import Landing from "@/pages/landing";
// import { useAuth } from "@/hooks/useAuth";

function Router() {
  // Temporarily bypass auth and landing page - go directly to dashboard
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/operator-settings" component={OperatorSettings} />
      <Route path="/uph-analytics" component={UphAnalytics} />
      <Route path="/fulfil-settings" component={FulfilSettings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  // Always show navigation since we're bypassing auth
  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <Router />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppContent />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
