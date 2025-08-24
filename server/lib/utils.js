function generateRoomCode(roomsMap) {
let code;
do { code = Math.random().toString(36).substring(2, 8).toUpperCase(); } while (roomsMap.has(code));
return code;
}
module.exports = { generateRoomCode };