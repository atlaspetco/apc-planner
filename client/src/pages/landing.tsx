import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, BarChart3, Users, Zap, ArrowRight, AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";

export default function Landing() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for error in URL query params
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get('error');
    if (errorParam) {
      setError(errorParam);
      // Clean up URL to remove error param
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      {/* Hero Section */}
      <div className="container mx-auto px-4 pt-16 pb-12">
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            Manufacturing Production Dashboard
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Optimize your production planning with real-time analytics, operator management, 
            and AI-powered work order assignments.
          </p>
          
          {error && (
            <Alert variant="destructive" className="mb-6 text-left">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Authentication failed: {error}
              </AlertDescription>
            </Alert>
          )}
          
          <a href="/api/auth/slack">
            <Button size="lg" className="gap-2">
              Sign in with Slack <ArrowRight className="h-4 w-4" />
            </Button>
          </a>
        </div>
      </div>

      {/* Features Section */}
      <div className="container mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
          Powerful Features for Production Management
        </h2>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <Shield className="h-10 w-10 text-blue-600 mb-4" />
              <CardTitle>Secure Access</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Protected access to your sensitive manufacturing data with enterprise-grade security.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardHeader>
              <BarChart3 className="h-10 w-10 text-green-600 mb-4" />
              <CardTitle>UPH Analytics</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Track Units Per Hour performance across operators, work centers, and product routings.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardHeader>
              <Users className="h-10 w-10 text-purple-600 mb-4" />
              <CardTitle>Operator Management</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Manage operator skills, availability, and performance with comprehensive tracking.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardHeader>
              <Zap className="h-10 w-10 text-orange-600 mb-4" />
              <CardTitle>AI Auto-Assign</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Intelligent work order assignments based on operator skills and historical performance.
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t bg-white mt-16">
        <div className="container mx-auto px-4 py-8">
          <p className="text-center text-gray-600">
            © 2025 Manufacturing Production Dashboard. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}