import { lazy, Suspense, type ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireRole } from '@/auth/RequireRole';
import { Layout } from '@/ui/Layout';
import { Spinner } from '@/ui/Feedback';
import Landing from '@/pages/Landing';
import SignIn from '@/pages/SignIn';

// every signed-in screen is its own chunk so the landing page stays light
const Onboarding = lazy(() => import('@/pages/customer/Onboarding'));
const Garage = lazy(() => import('@/pages/customer/Garage'));
const Book = lazy(() => import('@/pages/customer/Book'));
const BookingDetail = lazy(() => import('@/pages/customer/BookingDetail'));
const VehicleHealth = lazy(() => import('@/pages/customer/VehicleHealth'));
const TripPlanner = lazy(() => import('@/pages/customer/TripPlanner'));
const History = lazy(() => import('@/pages/customer/History'));

const Today = lazy(() => import('@/pages/mechanic/Today'));
const Apply = lazy(() => import('@/pages/mechanic/Apply'));
const MechanicPayments = lazy(() => import('@/pages/mechanic/Payments'));
const Insights = lazy(() => import('@/pages/mechanic/Insights'));

const Operations = lazy(() => import('@/pages/admin/Operations'));
const Kpis = lazy(() => import('@/pages/admin/Kpis'));
const Review = lazy(() => import('@/pages/admin/Review'));
const Cases = lazy(() => import('@/pages/admin/Cases'));
const Finance = lazy(() => import('@/pages/admin/Finance'));
const Models = lazy(() => import('@/pages/admin/Models'));

const customer = ['customer'] as const;
const mechanic = ['mechanic'] as const;
const admin = ['admin'] as const;
const anyRole = ['customer', 'mechanic', 'admin'] as const;

const wrap = (roles: readonly ('customer' | 'mechanic' | 'admin')[], el: ReactElement) => (
  <RequireRole roles={[...roles]}>{el}</RequireRole>
);

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="container-x py-24">
          <Spinner />
        </div>
      }
    >
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Landing />} />
          <Route path="signin" element={<SignIn />} />

          <Route path="onboarding" element={wrap(customer, <Onboarding />)} />
          <Route path="garage" element={wrap(customer, <Garage />)} />
          <Route path="vehicles/:id/health" element={wrap(customer, <VehicleHealth />)} />
          <Route path="trips" element={wrap(customer, <TripPlanner />)} />
          <Route path="book" element={wrap(customer, <Book />)} />
          <Route path="history" element={wrap(customer, <History />)} />
          <Route path="bookings/:id" element={wrap(anyRole, <BookingDetail />)} />

          <Route path="mechanic" element={wrap(mechanic, <Today />)} />
          <Route path="mechanic/payments" element={wrap(mechanic, <MechanicPayments />)} />
          <Route path="mechanic/insights" element={wrap(mechanic, <Insights />)} />
          {/* anyone signed in can apply; approval is what grants the mechanic role */}
          <Route path="mechanic/apply" element={wrap(anyRole, <Apply />)} />

          <Route path="admin" element={wrap(admin, <Operations />)} />
          <Route path="admin/kpis" element={wrap(admin, <Kpis />)} />
          <Route path="admin/review" element={wrap(admin, <Review />)} />
          <Route path="admin/cases" element={wrap(admin, <Cases />)} />
          <Route path="admin/finance" element={wrap(admin, <Finance />)} />
          <Route path="admin/models" element={wrap(admin, <Models />)} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
