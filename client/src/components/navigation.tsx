import { Link, useLocation } from "wouter";
import { BarChart3, Settings, Users, Zap, Calculator, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { LiveStatusIndicator } from "@/components/live-status-indicator";

const navigationItems = [
  { path: "/", label: "Dashboard", icon: BarChart3 },
  { path: "/operator-settings", label: "Operators", icon: Users },
  { path: "/uph-analytics", label: "UPH Analytics", icon: Calculator },
  { path: "/settings", label: "API Settings", icon: Settings },
];

export default function Navigation() {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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