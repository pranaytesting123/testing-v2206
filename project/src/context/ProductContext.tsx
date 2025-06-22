import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Product, Collection, HeroProduct, SiteSettings } from '../types';
import { supabase, setupBuildTriggers } from '../lib/supabase';

interface ProductContextType {
  products: Product[];
  collections: Collection[];
  siteSettings: SiteSettings;
  loading: boolean;
  error: string | null;
  addProduct: (product: Omit<Product, 'id' | 'createdAt'>) => Promise<void>;
  updateProduct: (id: string, product: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  addCollection: (collection: Omit<Collection, 'id' | 'createdAt'>) => Promise<void>;
  updateCollection: (id: string, collection: Partial<Collection>) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  updateHeroProduct: (heroProduct: HeroProduct) => Promise<void>;
  updateSiteSettings: (settings: Partial<SiteSettings>) => Promise<void>;
  getProductById: (id: string) => Product | undefined;
  getCollectionById: (id: string) => Collection | undefined;
  getProductsByCollection: (collection: string) => Product[];
  getFeaturedProducts: () => Product[];
  searchProducts: (query: string) => Product[];
  refreshData: () => Promise<void>;
}

const ProductContext = createContext<ProductContextType | undefined>(undefined);

export const useProducts = () => {
  const context = useContext(ProductContext);
  if (!context) {
    throw new Error('useProducts must be used within a ProductProvider');
  }
  return context;
};

interface ProductProviderProps {
  children: ReactNode;
}

export const ProductProvider: React.FC<ProductProviderProps> = ({ children }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>({
    heroProduct: {
      id: 'hero-1',
      title: 'Handcrafted Coconut Bowl Set',
      description: 'Transform your dining experience with our beautifully handcrafted coconut bowls.',
      image: 'https://images.pexels.com/photos/6542652/pexels-photo-6542652.jpeg?auto=compress&cs=tinysrgb&w=1200',
      ctaText: 'Shop Coconut Bowls',
      ctaLink: '/products?collection=Bowls & Tableware',
      price: 45.99
    },
    brandName: 'Everything Coconut',
    tagline: 'Sustainable Handmade Coconut Products'
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Convert database row to Product type
  const dbProductToProduct = (dbProduct: any, collections: Collection[]): Product => {
    const collection = collections.find(c => c.id === dbProduct.collection_id);
    return {
      id: dbProduct.id,
      name: dbProduct.name,
      price: dbProduct.price,
      description: dbProduct.description,
      image: dbProduct.image,
      collection: collection?.name || 'Unknown',
      featured: dbProduct.featured,
      createdAt: dbProduct.created_at,
    };
  };

  // Convert database row to Collection type
  const dbCollectionToCollection = (dbCollection: any): Collection => ({
    id: dbCollection.id,
    name: dbCollection.name,
    description: dbCollection.description,
    image: dbCollection.image,
    createdAt: dbCollection.created_at,
  });

  // Load data from Supabase
  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load collections first
      const { data: collectionsData, error: collectionsError } = await supabase
        .from('collections')
        .select('*')
        .order('name');

      if (collectionsError) throw collectionsError;

      const collectionsFormatted = collectionsData.map(dbCollectionToCollection);
      setCollections(collectionsFormatted);

      // Load products
      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });

      if (productsError) throw productsError;

      const productsFormatted = productsData.map(p => dbProductToProduct(p, collectionsFormatted));
      setProducts(productsFormatted);

      // Load site settings
      const { data: settingsData, error: settingsError } = await supabase
        .from('site_settings')
        .select('*');

      if (settingsError) throw settingsError;

      if (settingsData && settingsData.length > 0) {
        const heroProductSetting = settingsData.find(s => s.key === 'hero_product');
        const brandSetting = settingsData.find(s => s.key === 'brand_settings');

        setSiteSettings(prev => ({
          ...prev,
          ...(heroProductSetting ? { heroProduct: heroProductSetting.value } : {}),
          ...(brandSetting ? { 
            brandName: brandSetting.value.brandName,
            tagline: brandSetting.value.tagline 
          } : {}),
        }));
      }

    } catch (err) {
      console.error('Error loading data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // Initialize data and real-time subscriptions
  useEffect(() => {
    loadData();
    setupBuildTriggers();

    // Set up real-time subscriptions for UI updates
    const productsSubscription = supabase
      .channel('products-ui-updates')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'products' },
        () => loadData()
      )
      .subscribe();

    const collectionsSubscription = supabase
      .channel('collections-ui-updates')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'collections' },
        () => loadData()
      )
      .subscribe();

    const settingsSubscription = supabase
      .channel('settings-ui-updates')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'site_settings' },
        () => loadData()
      )
      .subscribe();

    return () => {
      productsSubscription.unsubscribe();
      collectionsSubscription.unsubscribe();
      settingsSubscription.unsubscribe();
    };
  }, []);

  const addProduct = async (productData: Omit<Product, 'id' | 'createdAt'>) => {
    try {
      const collection = collections.find(c => c.name === productData.collection);
      if (!collection) throw new Error('Collection not found');

      const { error } = await supabase
        .from('products')
        .insert({
          name: productData.name,
          price: productData.price,
          description: productData.description,
          image: productData.image,
          collection_id: collection.id,
          featured: productData.featured,
        });

      if (error) throw error;
    } catch (err) {
      console.error('Error adding product:', err);
      throw err;
    }
  };

  const updateProduct = async (id: string, productData: Partial<Product>) => {
    try {
      const updateData: any = {};
      
      if (productData.name !== undefined) updateData.name = productData.name;
      if (productData.price !== undefined) updateData.price = productData.price;
      if (productData.description !== undefined) updateData.description = productData.description;
      if (productData.image !== undefined) updateData.image = productData.image;
      if (productData.featured !== undefined) updateData.featured = productData.featured;
      
      if (productData.collection !== undefined) {
        const collection = collections.find(c => c.name === productData.collection);
        if (!collection) throw new Error('Collection not found');
        updateData.collection_id = collection.id;
      }

      const { error } = await supabase
        .from('products')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;
    } catch (err) {
      console.error('Error updating product:', err);
      throw err;
    }
  };

  const deleteProduct = async (id: string) => {
    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id);

      if (error) throw error;
    } catch (err) {
      console.error('Error deleting product:', err);
      throw err;
    }
  };

  const addCollection = async (collectionData: Omit<Collection, 'id' | 'createdAt'>) => {
    try {
      const { error } = await supabase
        .from('collections')
        .insert({
          name: collectionData.name,
          description: collectionData.description,
          image: collectionData.image,
        });

      if (error) throw error;
    } catch (err) {
      console.error('Error adding collection:', err);
      throw err;
    }
  };

  const updateCollection = async (id: string, collectionData: Partial<Collection>) => {
    try {
      const { error } = await supabase
        .from('collections')
        .update({
          name: collectionData.name,
          description: collectionData.description,
          image: collectionData.image,
        })
        .eq('id', id);

      if (error) throw error;
    } catch (err) {
      console.error('Error updating collection:', err);
      throw err;
    }
  };

  const deleteCollection = async (id: string) => {
    try {
      // Products will be deleted automatically due to CASCADE
      const { error } = await supabase
        .from('collections')
        .delete()
        .eq('id', id);

      if (error) throw error;
    } catch (err) {
      console.error('Error deleting collection:', err);
      throw err;
    }
  };

  const updateHeroProduct = async (heroProduct: HeroProduct) => {
    try {
      const { error } = await supabase
        .from('site_settings')
        .upsert({
          key: 'hero_product',
          value: heroProduct,
        });

      if (error) throw error;
    } catch (err) {
      console.error('Error updating hero product:', err);
      throw err;
    }
  };

  const updateSiteSettings = async (settings: Partial<SiteSettings>) => {
    try {
      if (settings.brandName || settings.tagline) {
        const { error } = await supabase
          .from('site_settings')
          .upsert({
            key: 'brand_settings',
            value: {
              brandName: settings.brandName || siteSettings.brandName,
              tagline: settings.tagline || siteSettings.tagline,
            },
          });

        if (error) throw error;
      }
    } catch (err) {
      console.error('Error updating site settings:', err);
      throw err;
    }
  };

  const getProductById = (id: string) => {
    return products.find(product => product.id === id);
  };

  const getCollectionById = (id: string) => {
    return collections.find(collection => collection.id === id);
  };

  const getProductsByCollection = (collection: string) => {
    if (collection === 'all') return products;
    return products.filter(product => 
      product.collection.toLowerCase() === collection.toLowerCase()
    );
  };

  const getFeaturedProducts = () => {
    return products.filter(product => product.featured);
  };

  const searchProducts = (query: string) => {
    if (!query.trim()) return products;
    
    const lowercaseQuery = query.toLowerCase();
    return products.filter(product =>
      product.name.toLowerCase().includes(lowercaseQuery) ||
      product.description.toLowerCase().includes(lowercaseQuery) ||
      product.collection.toLowerCase().includes(lowercaseQuery)
    );
  };

  const refreshData = async () => {
    await loadData();
  };

  return (
    <ProductContext.Provider
      value={{
        products,
        collections,
        siteSettings,
        loading,
        error,
        addProduct,
        updateProduct,
        deleteProduct,
        addCollection,
        updateCollection,
        deleteCollection,
        updateHeroProduct,
        updateSiteSettings,
        getProductById,
        getCollectionById,
        getProductsByCollection,
        getFeaturedProducts,
        searchProducts,
        refreshData,
      }}
    >
      {children}
    </ProductContext.Provider>
  );
};