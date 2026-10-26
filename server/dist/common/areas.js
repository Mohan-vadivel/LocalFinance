"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withAreas = void 0;
exports.routeAreas = routeAreas;
/** A route's areas for the apps: the main area (route.locationId) first, then the rest by name. */
function routeAreas(route) {
    return route.areas
        .map((a) => a.location)
        .sort((a, b) => Number(b.id === route.locationId) - Number(a.id === route.locationId) || a.name.localeCompare(b.name));
}
/** Include clause that loads a route's areas with their ids and names. */
exports.withAreas = { areas: { include: { location: { select: { id: true, name: true } } } } };
//# sourceMappingURL=areas.js.map