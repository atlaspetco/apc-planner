import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Calculator, Clock, Package } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';

interface UphCalculationModalProps {
  isOpen: boolean;
  onClose: () => void;
  operatorName: string;
  workCenter: string;
  routing: string;
  uphValue: number;
}

interface WorkCycleDetail {
  id: number;
  moNumber: string;
  woNumber: string;
  quantity: number;
  duration?: number;
  durationHours: number;
  uph: number;
  date?: string;
  operation: string;
  workCenter: string;
}

export function UphCalculationModal({
  isOpen,
  onClose,
  operatorName,
  workCenter,
  routing,
  uphValue
}: UphCalculationModalProps) {
  // Fetch detailed work cycles data for this specific UPH calculation
  const { data: cyclesData, isLoading } = useQuery({
    queryKey: ['/api/uph/calculation-details', operatorName, workCenter, routing],
    queryFn: async () => {
      const params = new URLSearchParams({
        operatorName,
        workCenter,
        routing
      });
      const response = await fetch(`/api/uph/calculation-details?${params}`);
      if (!response.ok) throw new Error('Failed to fetch calculation details');
      return response.json();
    },
    enabled: isOpen
  });

  const totalQuantity = cyclesData?.cycles?.reduce((sum: number, cycle: WorkCycleDetail) => sum + cycle.quantity, 0) || 0;
  const totalHours = cyclesData?.cycles?.reduce((sum: number, cycle: WorkCycleDetail) => sum + cycle.durationHours, 0) || 0;
  const calculatedUph = totalHours > 0 ? totalQuantity / totalHours : 0;

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            UPH Calculation Details
          </DialogTitle>
          <div className="text-sm text-muted-foreground mt-2">
            <p><strong>Operator:</strong> {operatorName}</p>
            <p><strong>Work Center:</strong> {workCenter}</p>
            <p><strong>Product Routing:</strong> {routing}</p>
          </div>
        </DialogHeader>

        <div className="mt-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-blue-600 font-medium">Total Quantity</p>
                  <p className="text-2xl font-bold text-blue-900">{totalQuantity?.toLocaleString() || '0'}</p>
                </div>
                <Package className="w-8 h-8 text-blue-300" />
              </div>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-green-600 font-medium">Total Hours</p>
                  <p className="text-2xl font-bold text-green-900">{totalHours?.toFixed(2) || '0.00'}</p>
                </div>
                <Clock className="w-8 h-8 text-green-300" />
              </div>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-purple-600 font-medium">Calculated UPH</p>
                  <p className="text-2xl font-bold text-purple-900">{calculatedUph?.toFixed(2) || '0.00'}</p>
                </div>
                <Calculator className="w-8 h-8 text-purple-300" />
              </div>
            </div>
          </div>

          {/* Calculation Formula */}
          <div className="bg-gray-50 p-4 rounded-lg mb-6">
            <p className="text-sm font-medium text-gray-700 mb-2">Calculation Formula:</p>
            <p className="font-mono text-lg">
              UPH = Total Quantity ÷ Total Hours = {totalQuantity?.toLocaleString() || '0'} ÷ {totalHours?.toFixed(2) || '0.00'} = <strong>{calculatedUph?.toFixed(2) || '0.00'}</strong>
            </p>
            {calculatedUph && uphValue && Math.abs(calculatedUph - uphValue) > 0.01 && (
              <p className="text-sm text-amber-600 mt-2">
                Note: Displayed UPH ({uphValue?.toFixed(2) || '0.00'}) may differ slightly due to rounding.
              </p>
            )}
          </div>

          {/* Detailed Work Cycles Table */}
          <div>
            <h3 className="text-sm font-medium mb-2">Work Cycles Used in Calculation:</h3>
            {workCenter === 'Assembly' && (
              <p className="text-sm text-amber-600 mb-3 bg-amber-50 p-3 rounded-lg">
                <strong>Note:</strong> Assembly includes work from both Sewing and Rope work centers. 
                The cycles below show the actual work center names as recorded in the system.
              </p>
            )}
            {isLoading ? (
              <div className="text-center py-4">Loading calculation details...</div>
            ) : cyclesData?.cycles && cyclesData.cycles.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>MO#</TableHead>
                      <TableHead>WO#</TableHead>
                      <TableHead>Work Center</TableHead>
                      <TableHead>Operation</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Duration (hrs)</TableHead>
                      <TableHead className="text-right">UPH</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cyclesData.cycles.map((cycle: WorkCycleDetail) => (
                      <TableRow key={cycle.id}>
                        <TableCell className="text-sm">
                          {cycle.date ? format(new Date(cycle.date), 'MMM d, yyyy') : 'N/A'}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{cycle.moNumber}</TableCell>
                        <TableCell className="font-mono text-sm">{cycle.woNumber}</TableCell>
                        <TableCell className="text-sm">{cycle.workCenter}</TableCell>
                        <TableCell className="text-sm">{cycle.operation}</TableCell>
                        <TableCell className="text-right">{cycle.quantity?.toLocaleString() || '0'}</TableCell>
                        <TableCell className="text-right">{cycle.durationHours?.toFixed(2) || '0.00'}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline">{cycle.uph?.toFixed(1) || '0.0'}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-4 text-gray-500">No work cycles found for this combination.</div>
            )}
          </div>

          {/* Statistics */}
          {cyclesData?.cycles && cyclesData.cycles.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground">
              <p><strong>Total Observations:</strong> {cyclesData.cycles.length}</p>
              <p><strong>Date Range:</strong> {
                (() => {
                  const validDates = cyclesData.cycles
                    .map((c: WorkCycleDetail) => c.date ? new Date(c.date).getTime() : null)
                    .filter(d => d !== null && !isNaN(d)) as number[];
                  
                  if (validDates.length === 0) return 'No valid dates';
                  
                  const minDate = new Date(Math.min(...validDates));
                  const maxDate = new Date(Math.max(...validDates));
                  
                  return `${format(minDate, 'MMM d, yyyy')} - ${format(maxDate, 'MMM d, yyyy')}`;
                })()
              }</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}