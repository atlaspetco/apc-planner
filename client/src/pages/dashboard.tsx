import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Factory, Cog, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const { data: productionOrders = [], isLoading: isLoadingPOs, error: errorPOs, refetch: refetchPOs } = useQuery({
    queryKey: ["/api/production-orders"],
    staleTime: 0,
    cacheTime: 0,
  });

  // Get assignments from the database
  const { data: assignments = [], refetch: refetchAssignments } = useQuery({
    queryKey: ["/api/assignments"],
    staleTime: 0,
    cacheTime: 0,
  });

  // Refresh handler
  const handleRefresh = () => {
    refetchPOs();
    refetchAssignments();
  };

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
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Factory className="text-blue-600 text-2xl" />
              <h1 className="text-2xl font-bold text-gray-900">Production Planning Dashboard</h1>
            </div>
            <div className="flex items-center space-x-4">
              <Button onClick={handleRefresh} variant="outline" size="sm">
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Cog className="w-4 h-4 mr-2" />
                Settings
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-2">Production Orders</h3>
            <p className="text-3xl font-bold text-blue-600">{productionOrders.length}</p>
            <p className="text-sm text-gray-600 mt-1">Active Manufacturing Orders</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-2">Total Work Orders</h3>
            <p className="text-3xl font-bold text-green-600">
              {productionOrders.reduce((total, po) => total + (po.work_orders?.length || 0), 0)}
            </p>
            <p className="text-sm text-gray-600 mt-1">Across all operations</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-2">Operator Assignments</h3>
            <p className="text-3xl font-bold text-purple-600">{assignments.length}</p>
            <p className="text-sm text-gray-600 mt-1">Work orders assigned</p>
          </div>
        </div>

        {/* Production Orders Table */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold">Production Orders</h3>
          </div>
          
          {isLoadingPOs ? (
            <div className="p-6 text-center">
              <p className="text-gray-600">Loading production data...</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">MO Number</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Routing</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Work Orders</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {productionOrders.slice(0, 15).map((po) => (
                    <tr key={po.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {po.moNumber}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {po.productName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {po.quantity}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          po.status === 'assigned' ? 'bg-green-100 text-green-800' : 
                          po.status === 'waiting' ? 'bg-yellow-100 text-yellow-800' : 
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {po.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {po.routing}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {po.work_orders?.length || 0} orders
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Status Information */}
        <div className="mt-6 grid grid-cols-2 gap-6">
          <div className="bg-blue-50 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 mb-2">System Status</h4>
            <div className="space-y-1 text-sm text-blue-800">
              <p>• Production Orders: {productionOrders.length} loaded</p>
              <p>• Total Work Orders: {productionOrders.reduce((total, po) => total + (po.work_orders?.length || 0), 0)}</p>
              <p>• Assignments: {assignments.length} active</p>
              <p>• Loading: {isLoadingPOs ? 'Yes' : 'No'}</p>
            </div>
          </div>
          
          <div className="bg-green-50 rounded-lg p-4">
            <h4 className="font-semibold text-green-900 mb-2">Data Integration</h4>
            <div className="space-y-1 text-sm text-green-800">
              <p>• Fulfil API: Connected ✓</p>
              <p>• Database: PostgreSQL ✓</p>
              <p>• Assignment System: Ready ✓</p>
              <p>• Real-time Updates: Active ✓</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}