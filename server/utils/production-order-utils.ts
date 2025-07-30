// Utility functions for production order processing

export function enrichProductionOrders(orders: any[]): any[] {
  // Group work orders by production order
  const productionOrderMap = new Map<number, any>();
  
  orders.forEach(workOrder => {
    const productionId = workOrder.production;
    
    if (!productionOrderMap.has(productionId)) {
      productionOrderMap.set(productionId, {
        id: productionId,
        moNumber: workOrder.production_rec_name?.split(' | ')[0] || `MO${productionId}`,
        state: workOrder.production_state || 'unknown',
        quantity: workOrder.production_quantity || 0,
        plannedDate: workOrder.production_planned_date,
        productName: workOrder.product_name || 'Unknown Product',
        productCode: workOrder.product_code || '',
        routing: workOrder.production_routing_name || 'Unknown',
        routingName: workOrder.production_routing_name || 'Unknown',
        workOrders: []
      });
    }
    
    const productionOrder = productionOrderMap.get(productionId);
    productionOrder.workOrders.push({
      id: workOrder.id,
      state: workOrder.state,
      workCenter: workOrder.work_center_name || 'Unknown',
      originalWorkCenter: workOrder.work_center_name,
      operation: workOrder.operation_name || 'Unknown',
      quantity: workOrder.quantity || productionOrder.quantity,
      employee: workOrder.employee_name,
      employee_id: workOrder.employee
    });
  });
  
  return Array.from(productionOrderMap.values());
}

export function cleanWorkOrderKey(key: string): string {
  // Clean work order keys for consistent comparison
  return key.toString().trim();
}