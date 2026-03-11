import cloudinary from '../config/cloudinaryConfig';

interface CloudinaryUploadResult {
  url: string;
  public_id: string;
}

const cloudinaryService = {
  /**
   * Upload an image to Cloudinary
   * @param fileData File data (base64 or buffer)
   * @param folder Folder to upload to
   */
  uploadImage: async (fileData: string, folder: string = 'escrow'): Promise<CloudinaryUploadResult> => {
    try {
      const result = await cloudinary.uploader.upload(fileData, {
        folder: `padlok/${folder}`,
        resource_type: 'auto',
      });

      return {
        url: result.secure_url,
        public_id: result.public_id,
      };
    } catch (error) {
      console.error('Cloudinary upload error:', error);
      throw new Error('Failed to upload image to Cloudinary');
    }
  },

  /**
   * Delete an image from Cloudinary
   * @param publicId Public ID of the image
   */
  deleteImage: async (publicId: string): Promise<void> => {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      console.error('Cloudinary delete error:', error);
      throw new Error('Failed to delete image from Cloudinary');
    }
  },
};

export default cloudinaryService;
