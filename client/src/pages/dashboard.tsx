import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Factory, Cog, RefreshCw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import FilterControls from "@/components/dashboard/filter-controls";
import SummaryCards from "@/components/dashboard/summary-cards";
import PlanningGrid from "@/components/dashboard/planning-grid";
import OperatorSummary from "@/components/dashboard/operator-summary";
import MOWorkCenters from "@/components/dashboard/mo-work-centers";


export default function Dashboard() {
  const [statusFilter, setStatusFilter] = useState<string[]>(["assigned", "waiting", "running", "draft"]);
  const [routingFilter, setRoutingFilter] = useState<string>("all");
  const [selectedMOs, setSelectedMOs] = useState<number[]>([]);

  // Use a stable query key and filter client-side for better caching
  const { data: allProductionOrders = [], isLoading: isLoadingPOs, error: errorPOs, refetch: refetchPOs } = useQuery({
    queryKey: ["/api/production-orders"], // Remove dynamic filter from query key
    enabled: true,
    retry: 1,
    retryDelay: 1000,
    staleTime: 5 * 60 * 1000, // 5 minutes cache
  });

  // Filter client-side instead of server-side for better performance
  const productionOrders = allProductionOrders.filter(po => {
    if (statusFilter.length === 0) return true;
    return statusFilter.includes(po.status);
  });

  // Get current production orders from Fulfil API
  const { data: currentPOs = [], isLoading: isLoadingCurrentPOs, refetch: refetchCurrentPOs } = useQuery({
    queryKey: ["/api/fulfil/current-production-orders"],
    retry: 1,
    retryDelay: 1000,
    staleTime: 10 * 60 * 1000, // 10 minutes cache for Fulfil data
  });

  const { data: summary, isLoading: isLoadingSummary, error: errorSummary, refetch: refetchSummary } = useQuery({
    queryKey: ["/api/dashboard/summary"],
    retry: 1,
    retryDelay: 1000,
    staleTime: 2 * 60 * 1000, // 2 minutes cache for summary
  });

  const handleRefresh = () => {
    // Manually refresh only when user clicks refresh
    refetchPOs();
    refetchSummary();
    refetchCurrentPOs();
  };

  const handleAddWorkCenter = (moId: string, workCenter: string) => {
    console.log(`Adding work center ${workCenter} to MO ${moId}`);
    // TODO: Implement work center assignment API
  };

  const handleAssignOperator = (workOrderId: string, operatorId: string) => {
    console.log(`Assigning operator ${operatorId} to work order ${workOrderId}`);
    // TODO: Implement operator assignment API
  };

  const handleStatusFilterChange = (newFilter: string[]) => {
    setStatusFilter(newFilter);
  };

  const handleRoutingFilterChange = (routing: string) => {
    setRoutingFilter(routing);
  };

  const handleMOSelection = (moIds: number[]) => {
    setSelectedMOs(moIds);
  };

  // Show error state if API calls fail
  if (errorPOs || errorSummary) {
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
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Factory className="text-blue-600 text-2xl" />
              <h1 className="text-2xl font-bold text-gray-900">Production Planning Dashboard</h1>
            </div>
            <div className="flex items-center space-x-4">

              <Button 
                className="bg-blue-600 hover:bg-blue-700"
                onClick={() => window.location.href = '/operator-settings'}
              >
                <Cog className="w-4 h-4 mr-2" />
                Settings
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Filter Controls */}
        <FilterControls 
          statusFilter={statusFilter}
          onStatusFilterChange={handleStatusFilterChange}
          routingFilter={routingFilter}
          onRoutingFilterChange={handleRoutingFilterChange}
          selectedMOs={selectedMOs}
          onRefreshData={() => {
            refetchPOs();
          }}
        />

        {/* Summary Cards */}
        <SummaryCards summary={summary} isLoading={isLoadingSummary} />

        {/* Status Info */}
        <div className="mb-4">
          <p className="text-sm text-muted-foreground">
            Latest database data - {productionOrders?.length || 0} production orders loaded
          </p>
        </div>

        {/* Main Planning Grid */}
        <PlanningGrid 
          productionOrders={productionOrders || []}
          isLoading={isLoadingPOs}
          selectedMOs={selectedMOs}
          onMOSelection={handleMOSelection}
        />

        {/* Operator Summary */}
        <OperatorSummary />
      </div>
    </div>
  );
}
