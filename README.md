# Atlas Pet Co - Manufacturing Planning Dashboard

A comprehensive React + Express + TypeScript application for manufacturing production planning, designed specifically for Atlas Pet Company's operations. The system integrates with Fulfil.io API to manage Production Orders (MOs), Work Orders (WOs), and operator assignments across different work centers.

## 🎯 Key Features

- **Real-time Production Dashboard** - Visual planning grid showing MOs across work centers
- **Fulfil.io Integration** - Direct API connection for production data synchronization  
- **UPH Analytics** - Units Per Hour performance tracking from work cycles data
- **Operator Management** - Skills, availability, and performance analytics
- **Batch Planning** - Grouping and scheduling of related production orders
- **Live Data Refresh** - One-click refresh of current production orders

## 🏗️ Architecture

### Frontend
- **React 18** with TypeScript and Vite
- **Shadcn/ui** components with Tailwind CSS
- **TanStack Query** for server state management
- **Wouter** for lightweight routing

### Backend  
- **Express.js** with TypeScript
- **PostgreSQL** database with Drizzle ORM
- **Neon Database** for cloud PostgreSQL
- **RESTful API** design with validation

### External Integrations
- **Fulfil.io API** - Production data source
- **OpenAI API** - Anomaly detection in UPH calculations

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- PostgreSQL database
- Fulfil.io API access token

### Environment Variables
```bash
DATABASE_URL=postgresql://...
FULFIL_ACCESS_TOKEN=your_fulfil_token
OPENAI_API_KEY=your_openai_key
```

### Installation
```bash
npm install
npm run db:push  # Setup database schema
npm run dev      # Start development server
```

## 📊 Manufacturing Workflow

1. **Production Orders** - Created with specific products and quantities
2. **Work Orders** - Generated for each operation (Cutting, Sewing, Packaging)
3. **Operator Assignment** - Based on skills, availability, and performance
4. **UPH Tracking** - Real-time efficiency monitoring
5. **Batch Management** - Grouping orders for optimized scheduling

## 🔧 Core Operations

### Data Refresh
- Clears old production orders and work orders
- Fetches current active MOs from Fulfil API
- Generates work orders for all operations
- Maintains proper foreign key relationships

### UPH Calculations
- Processes work cycles data from Fulfil
- Calculates operator performance metrics
- Identifies efficiency patterns and anomalies
- Supports filtering by work center, operator, routing

### Planning Grid
- Visual interface for production scheduling
- Drag-and-drop operator assignments
- Real-time status updates
- Batch grouping capabilities

## 📁 Project Structure

```
├── client/          # React frontend
│   ├── src/
│   │   ├── pages/           # Main application pages
│   │   ├── components/      # Reusable UI components
│   │   └── lib/            # Utilities and hooks
├── server/          # Express backend
│   ├── routes.ts           # API endpoints
│   ├── db.ts              # Database connection
│   └── fulfil-api.ts      # Fulfil integration
├── shared/          # Common types and schemas
│   └── schema.ts          # Database schema definition
└── docs/           # Documentation
```

## 🔌 API Endpoints

### Production Orders
- `GET /api/production-orders` - List all production orders
- `POST /api/fulfil/refresh-recent` - Refresh current data

### Work Orders  
- `GET /api/work-orders` - List all work orders
- `GET /api/work-orders/by-production-order/:id` - Get work orders for MO

### Analytics
- `GET /api/dashboard/summary` - Dashboard statistics
- `GET /api/uph-data` - UPH performance metrics

### Operators
- `GET /api/operators` - List all operators
- `POST /api/operators/auto-configure-work-centers` - Auto-configure settings

## 🔄 Fulfil.io Integration

### Authentication
- Uses `X-API-KEY` header with personal access token
- Base URL: `https://apc.fulfil.io`
- API Version: v2

### Data Models
- **Production Orders** - Main manufacturing orders
- **Work Orders** - Individual operation steps  
- **Work Cycles** - Performance tracking data
- **Operators** - Employee data and assignments

## 📈 UPH Analytics

### Performance Metrics
- Units per hour by operator and operation
- Historical trend analysis
- Efficiency benchmarking
- Anomaly detection using AI

### Filtering Options
- Work center (Cutting, Sewing, Packaging)
- Product routing (Lifetime Leash, Lifetime Bowl, etc.)
- Operator performance
- Date ranges

## 🛠️ Development

### Database Migrations
```bash
npm run db:push    # Apply schema changes
npm run db:studio  # Open database browser
```

### Code Quality
- TypeScript strict mode
- ESLint configuration
- Prettier formatting
- Zod validation schemas

## 📦 Deployment

The application is configured for Replit deployment with:
- Automatic workflow management
- Environment variable handling
- Database connection pooling
- Production optimizations

## 🔒 Security

- Environment-based secrets management
- PostgreSQL connection security
- API key protection
- Input validation and sanitization

## 📝 License

Internal use for Atlas Pet Company manufacturing operations.

---

For support or questions, contact the development team.