import type { Db } from '../db/supabase';
import { unwrap } from '../db/supabase';
import type { OfferStore } from '../routes/offers';

export function supabaseOffers(db: Db): OfferStore {
  return {
    async respond(offerId, response, actorId, actorRole) {
      const res = await db
        .rpc('respond_offer', {
          p_offer: offerId,
          p_response: response,
          p_actor: actorId,
          p_actor_role: actorRole,
        })
        .single();
      return unwrap(res) as { id: string; booking_id: string; response: string };
    },
  };
}
