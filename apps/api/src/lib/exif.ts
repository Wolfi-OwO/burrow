import exifr from 'exifr';

export interface ExifInfo {
    latitude: number | null;
    longitude: number | null;
    takenAt: Date | null;
}

/** @returns Where and when a photo says it was taken, or null when it carries neither (or cannot be read). */
export async function readExif(path: string): Promise<ExifInfo | null> {
    try {
        const data = (await exifr.parse(path, {
            gps: true,
            pick: ['DateTimeOriginal', 'latitude', 'longitude'],
        })) as { latitude?: number; longitude?: number; DateTimeOriginal?: Date } | undefined;
        if (!data) return null;
        const latitude = typeof data.latitude === 'number' ? data.latitude : null;
        const longitude = typeof data.longitude === 'number' ? data.longitude : null;
        const takenAt = data.DateTimeOriginal instanceof Date ? data.DateTimeOriginal : null;
        return latitude === null && longitude === null && takenAt === null
            ? null
            : { latitude, longitude, takenAt };
    } catch {
        // Not every image has metadata, and a damaged block must not fail the upload.
        return null;
    }
}
