import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Factory } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ProductionGrid from "@/components/dashboard/production-grid";
import { OperatorWorkloadSummary } from "@/components/dashboard/operator-workload-summary";

export default function Dashboard() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [routingFilter, setRoutingFilter] = useState<string>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: productionOrders = [], isLoading: isLoadingPOs, error: errorPOs, refetch: refetchPOs } = useQuery({
    queryKey: ["/api/production-orders"],
    staleTime: 0,
    gcTime: 0,
  });

  const { data: assignmentsData, isLoading: isLoadingAssignments, refetch: refetchAssignments } = useQuery({
    queryKey: ["/api/assignments"],
    staleTime: 0,
    gcTime: 0,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Fetch latest production orders (includes waiting, assigned, and running states)
      await Promise.all([refetchPOs(), refetchAssignments()]);
      console.log('Dashboard refresh completed - updated with waiting, assigned, and running MOs');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Filter production orders based on selected filters
  const filteredOrders = productionOrders.filter(order => {
    const statusMatch = statusFilter === "all" || order.status === statusFilter;
    const routingMatch = routingFilter === "all" || order.routing === routingFilter;
    return statusMatch && routingMatch;
  });

  // Get unique statuses and routings for filter options
  const uniqueStatuses = [...new Set(productionOrders.map(order => order.status))];
  const uniqueRoutings = [...new Set(productionOrders.map(order => order.routing))];

  // Status indicator color  
  const statusIndicator = isLoadingPOs || isLoadingAssignments || isRefreshing ? "yellow" : errorPOs ? "red" : "green";

  // Create assignments lookup map for easy access
  const assignmentsMap = new Map();
  if (assignmentsData?.assignments) {
    assignmentsData.assignments.forEach(assignment => {
      assignmentsMap.set(assignment.workOrderId, assignment);
    });
    console.log('Assignments Map created:', { 
      totalAssignments: assignmentsData.assignments.length,
      mapSize: assignmentsMap.size,
      sampleKeys: Array.from(assignmentsMap.keys()).slice(0, 5),
      sampleEntries: Array.from(assignmentsMap.entries()).slice(0, 3)
    });
  }

  // Show error state if API calls fail
  if (errorPOs) {
    return (
      <div className="bg-gray-50 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Connection Error</h2>
          <p className="text-gray-600 mb-4">Unable to load dashboard data</p>
          <Button onClick={handleRefresh}>Try Again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Header with streamlined controls */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Factory className="text-blue-600 text-2xl" />
              <h1 className="text-2xl font-bold text-gray-900">Production Planning Dashboard</h1>
            </div>
            
            {/* Right side controls */}
            <div className="flex items-center space-x-4">
              {/* Live status indicator */}
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${
                  statusIndicator === "green" ? "bg-green-500" : 
                  statusIndicator === "yellow" ? "bg-yellow-500 animate-pulse" : 
                  "bg-red-500"
                }`}></div>
                <span className="text-sm text-gray-600">
                  {isRefreshing ? "Refreshing MOs..." : 
                   isLoadingPOs ? "Loading..." : 
                   errorPOs ? "Error" : "Live"}
                </span>
              </div>
              
              {/* Refresh button */}
              <Button 
                variant="outline"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="flex items-center space-x-2"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </Button>
            </div>
          </div>
          
          {/* Compact filter row */}
          <div className="flex items-center space-x-4 mt-4">
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">Status:</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {uniqueStatuses.map(status => (
                    <SelectItem key={status} value={status}>{status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">Routing:</label>
              <Select value={routingFilter} onValueChange={setRoutingFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {uniqueRoutings.map(routing => (
                    <SelectItem key={routing} value={routing}>{routing}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="text-sm text-gray-600">
              {filteredOrders.length} of {productionOrders.length} orders
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Operator Workload Summary */}
        <OperatorWorkloadSummary assignments={assignmentsMap} />
        
        <ProductionGrid 
          productionOrders={filteredOrders}
          isLoading={isLoadingPOs}
          assignments={assignmentsMap}
          onAssignmentChange={refetchAssignments}
        />
      </div>
    </div>
  );
}