import { Link, useLocation } from "wouter";
import { BarChart3, Settings, Users, Zap, Calculator, Menu, X, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { LiveStatusIndicator } from "@/components/live-status-indicator";
import { useAuth } from "@/hooks/useAuth";

const navigationItems = [
  { path: "/", label: "Dashboard", icon: BarChart3 },
  { path: "/operator-settings", label: "Operators", icon: Users },
  { path: "/uph-analytics", label: "UPH Analytics", icon: Calculator },
  { path: "/fulfil-settings", label: "Fulfil Settings", icon: Settings },
];

export default function Navigation() {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user } = useAuth();

  const NavItems = ({ mobile = false, onItemClick = () => {} }) => (
    <>
      {navigationItems.map((item) => {
        const Icon = item.icon;
        const isActive = location === item.path;
        
        return (
          <Link
            key={item.path}
            href={item.path}
            onClick={onItemClick}
            className={cn(
              mobile 
                ? "flex items-center px-4 py-3 text-base font-medium rounded-md"
                : "inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium",
              isActive
                ? mobile 
                  ? "bg-blue-100 text-blue-900"
                  : "border-blue-500 text-gray-900"
                : mobile
                  ? "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            )}
          >
            <Icon className={cn("w-4 h-4", mobile ? "mr-3" : "mr-2")} />
            {item.label}
          </Link>
        );
      })}
    </>
  );

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <h1 className="text-xl font-bold text-gray-900">Production Planning</h1>
            </div>
            <div className="hidden sm:ml-8 sm:flex sm:space-x-8">
              <NavItems />
            </div>
          </div>
          
          {/* Live status and Mobile menu button */}
          <div className="flex items-center space-x-3">
            <LiveStatusIndicator />
            
            {/* User info and logout button - desktop */}
            <div className="hidden sm:flex items-center space-x-4">
              {user && (
                <>
                  <span className="text-sm text-gray-600">
                    {user.email || `User ${user.id}`}
                  </span>
                  <a href="/api/logout">
                    <Button variant="ghost" size="sm" className="gap-2">
                      <LogOut className="h-4 w-4" />
                      Logout
                    </Button>
                  </a>
                </>
              )}
            </div>
            
            <div className="sm:hidden">
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="sm" className="p-2">
                    <Menu className="h-6 w-6" />
                    <span className="sr-only">Open menu</span>
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-64">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-semibold">Navigation</h2>
                  </div>
                  <nav className="space-y-1" aria-label="Mobile navigation">
                    <NavItems mobile onItemClick={() => setMobileMenuOpen(false)} />
                    
                    {/* User info and logout - mobile */}
                    {user && (
                      <div className="mt-6 pt-6 border-t border-gray-200">
                        <p className="px-4 text-sm text-gray-600 mb-4">
                          {user.email || `User ${user.id}`}
                        </p>
                        <a href="/api/logout" className="block">
                          <Button variant="ghost" className="w-full justify-start gap-2">
                            <LogOut className="h-4 w-4" />
                            Logout
                          </Button>
                        </a>
                      </div>
                    )}
                  </nav>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}