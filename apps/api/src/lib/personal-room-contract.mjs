// Capability negotiates the DTO/write protocol, never identity or permission.
export const personalRooms = request => request.headers?.get?.('x-burrow-rooms') === 'personal-v2';
export const roomMutationNeedsUpgrade = (request, body) => personalRooms(request) &&
 ['save_room_loadout','purchase_room_loadout'].includes(body.action);
